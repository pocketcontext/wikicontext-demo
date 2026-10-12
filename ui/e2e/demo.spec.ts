import { expect, test, type Page, type APIRequestContext } from "@playwright/test";

async function signIn(page: Page, request: APIRequestContext, name: string) {
  const response = await request.post(process.env.WIKICONTEXT_TEST_CONTROL + "/session/" + name);
  expect(response.ok()).toBeTruthy();
  const session = await response.json();
  // OAuth exchange is performed against the synthetic provider by the fixture;
  // only the external popup is excluded from this local browser test.
  await page.evaluate(value => localStorage.setItem("wikicontext.reader.auth", JSON.stringify(value)), session);
  await page.reload();
  await expect(page.getByRole("checkbox", { name: /I accept the demo terms/ })).toBeEnabled();
  await expect(page.locator("#enrollment-card")).toBeFocused();
  await expect(page.getByRole("heading", { name: "Review your choices.", exact: true })).toBeInViewport();
}

async function expectConsentGate(page: Page) {
  await expect(page.getByRole("checkbox", { name: /I accept the demo terms/ })).not.toBeChecked();
  await expect(page.getByRole("link", { name: "Connect your coding agent", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Open your wiki", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Coding-agent setup instructions")).toHaveCount(0);
  await expect(page.locator(".sidebar")).toHaveCount(0);
}

async function expectInstructions(page: Page) {
  await expect(page.getByLabel("Coding-agent setup instructions")).toBeVisible();
  await expect(page.locator(".sidebar")).toHaveCount(0);
}

async function expectSignedOutChoices(page: Page) {
  for (const name of [/I accept the demo terms/, /commercial offers/, /newsletter/]) {
    const checkbox = page.getByRole("checkbox", { name });
    await expect(checkbox).toBeVisible();
    await expect(checkbox).not.toBeChecked();
    await expect(checkbox).toBeDisabled();
  }
  await expect(page.getByRole("button", { name: "Accept terms & show instructions", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Accept terms & open wiki", exact: true })).toBeDisabled();
}

test("landing matches the light public-demo shell despite saved and system dark preferences", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.addInitScript(() => localStorage.setItem("wiki-theme", "dark"));
  await page.goto("/");
  await expect(page).toHaveTitle("Try WikiContext · Public demo");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("html")).toHaveCSS("color-scheme", "light");
  await expect(page.getByRole("button", { name: /Switch to .* theme/ })).toHaveCount(0);
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  for (const name of ["How it works", "Your data", "Explore the demo"]) {
    await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
  }
  const footer = page.locator("footer");
  await expect(footer.getByRole("link", { name: "WikiContext home" })).toBeVisible();
  await expect(footer.getByRole("link", { name: "Terms", exact: true })).toHaveAttribute("href", "/terms/");
  await expect(footer.getByRole("link", { name: "Privacy", exact: true })).toHaveAttribute("href", "/privacy/");
  await footer.getByRole("link", { name: "Back to the start ↑", exact: true }).click();
  await expect(page.locator("#start")).toBeInViewport();
  await page.reload();
  await expect(page).toHaveTitle("Try WikiContext · Public demo");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("legal pages retain the light palette under a dark system preference", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  for (const route of ["/terms/", "/privacy/"]) {
    await page.goto(route);
    await expect(page.locator("html")).toHaveCSS("color-scheme", "light");
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(247, 247, 240)");
    await expect(page.locator("body")).toHaveCSS("color", "rgb(38, 55, 45)");
  }
});

test("anonymous setup permalink focuses the sign-in and consent section", async ({ page }) => {
  await page.goto("/#/setup");
  await expectSignedOutChoices(page);
  await expect(page.locator("#start")).toBeFocused();
  await expect(page.locator("#start")).toBeInViewport();
  await expect(page.getByLabel("Coding-agent setup instructions")).toHaveCount(0);
});

test("daily consent, conflicts, agent setup and private live reader", async ({ page, request, context }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/#/page/private-observatory");
  await expect(page.getByRole("button", { name: "Continue with Google", exact: true })).toBeEnabled();
  await expectSignedOutChoices(page);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.screenshot({ path: "/tmp/wikicontext-demo-desktop.png", fullPage: true });
  await signIn(page, request, "reader");
  await expectConsentGate(page);
  await expect(page.getByRole("heading", { name: "Review your choices.", exact: true })).toBeVisible();
  await expect(page.getByText("Daily reset", { exact: true })).toBeVisible();
  await expect(page.locator(".enrollment-card legend")).toBeVisible();
  await expect(page.locator(".enrollment-card legend")).toHaveText("Your choices");
  await expect(page.locator(".enrollment-card .identity")).toContainText("reader@example.test");
  await expect(page.locator(".enrollment-card")).not.toContainText("Sign in with Google, then");
  await page.locator(".enrollment-card").screenshot({ path: "/tmp/wikicontext-demo-consent-card.png" });
  const terms = page.getByRole("checkbox", { name: /I accept the demo terms/ });
  const submit = page.getByRole("button", { name: "Accept terms & show instructions", exact: true });
  await expect(submit).toBeEnabled();
  await expect(page.getByText("Select the terms checkbox to continue.", { exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /commercial offers/ })).not.toBeChecked();
  await expect(page.getByRole("checkbox", { name: /newsletter/ })).not.toBeChecked();
  let submissions = 0;
  await page.route("**/api/demo/enroll", async route => {
    submissions++;
    if (submissions === 1) await route.fulfill({ status: 409, json: { message: "Synthetic conflict" } });
    else await route.continue();
  });
  await submit.click();
  await expect(terms).toBeFocused();
  expect(await terms.evaluate((input: HTMLInputElement) => input.validity.valueMissing && !!input.validationMessage)).toBeTruthy();
  expect(submissions).toBe(0);
  await terms.check(); await submit.click();
  await expect(page.getByRole("status").filter({ hasText: "preferences changed elsewhere" })).toBeVisible();
  await expect(terms).not.toBeChecked();
  await expect(submit).toBeEnabled();
  expect(submissions).toBe(1);
  await submit.focus();
  await page.keyboard.press("Enter");
  await expect(terms).toBeFocused();
  expect(submissions).toBe(1);
  await expect(page.getByRole("checkbox", { name: /commercial offers/ })).not.toBeChecked();
  await expect(page.getByRole("checkbox", { name: /newsletter/ })).not.toBeChecked();
  await terms.check(); await submit.click();
  await expectInstructions(page);
  await expect(page.getByRole("heading", { name: "Connect your coding agent.", exact: true })).toBeVisible();
  await expect(page.locator("#setup")).toBeFocused();
  await page.locator("#setup").screenshot({ path: "/tmp/wikicontext-demo-agent-guide.png" });
  await expectInstructions(page);
  await expect(page.getByLabel("Coding-agent setup instructions")).toContainText("reader@example.test");
  await expect(page.getByLabel("Coding-agent setup instructions")).toContainText("wikicontext-demo");
  await expect(page.getByRole("table", { name: "Today’s usage and daily limits" })).toBeVisible();
  await page.locator("summary").filter({ hasText: "Manage contact permissions" }).click();
  const withdrawalHref = await page.getByRole("link", { name: "Private withdrawal link", exact: true }).getAttribute("href");
  expect(withdrawalHref).toContain("/#/withdraw/");
  const privateContext = await context.browser()!.newContext({ viewport: { width: 375, height: 812 } });
  const withdrawalPage = await privateContext.newPage();
  const withdrawalRequests: string[] = [];
  withdrawalPage.on("request", request => {
    if (request.url().endsWith("/api/demo/unsubscribe")) {
      withdrawalRequests.push(request.method());
      expect(request.headers().authorization).toBeUndefined();
    }
  });
  await withdrawalPage.goto(withdrawalHref!);
  await expect(withdrawalPage.getByRole("heading", { name: "Withdraw marketing permissions" })).toBeVisible();
  expect(new URL(withdrawalPage.url()).hash).toBe("#/withdraw");
  expect(withdrawalRequests).toEqual([]);
  expect(await withdrawalPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await withdrawalPage.keyboard.press("Tab");
  await expect(withdrawalPage.getByRole("button", { name: "Withdraw both marketing permissions" })).toBeFocused();
  await withdrawalPage.keyboard.press("Enter");
  await expect(withdrawalPage.getByRole("status")).toContainText("Both marketing permissions withdrawn");
  expect(withdrawalRequests).toEqual(["POST"]);
  await withdrawalPage.reload();
  await expect(withdrawalPage.getByRole("status")).toContainText("This withdrawal link is incomplete");
  await expect(withdrawalPage.getByRole("button")).toBeDisabled();
  await privateContext.close();
  await page.locator("#setup summary").filter({ hasText: "Read your cited wiki" }).click();
  await page.getByRole("link", { name: "Open your wiki", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your wiki is empty — for now" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Space", exact: true })).toHaveCount(0);
  const response = await request.post(process.env.WIKICONTEXT_TEST_CONTROL + "/publish");
  expect(response.ok(), await response.text()).toBeTruthy();
  await expect(page.getByRole("heading", { name: "Private observatory", exact: true })).toBeVisible();
  await page.keyboard.press("/");
  const search = page.locator('.sidebar input[type="search"]');
  await expect(search).toBeFocused();
  await search.fill("starlight"); await search.press("Enter");
  await expect(page.getByRole("link", { name: /Private observatory/ }).first()).toBeVisible();
  const peer = await context.newPage();
  await peer.goto("/#/page/private-observatory");
  await expectConsentGate(peer);
  await expect(peer.getByRole("heading", { name: "Private observatory", exact: true })).toHaveCount(0);
  await peer.getByRole("checkbox", { name: /I accept the demo terms/ }).check();
  await peer.getByRole("button", { name: "Accept terms & open wiki", exact: true }).click();
  await expect(peer.getByRole("heading", { name: "Private observatory", exact: true })).toBeVisible();
  await peer.evaluate(() => localStorage.removeItem("wikicontext.reader.auth"));
  await expect(page.getByRole("button", { name: "Continue with Google", exact: true })).toBeVisible();
  await expect(page.getByText("Private starlight observation.", { exact: false })).toHaveCount(0);
  await signIn(page, request, "other");
  await terms.check();
  await page.getByRole("button", { name: "Accept terms & open wiki", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your wiki is empty — for now" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Private observatory", exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("enrolled visitors can review, save and withdraw their retained choices", async ({ page, request }) => {
  await page.goto("/");
  await signIn(page, request, "persistent-choices");
  const terms = page.getByRole("checkbox", { name: /I accept the demo terms/ });
  const sales = page.getByRole("checkbox", { name: /commercial offers/ });
  const newsletter = page.getByRole("checkbox", { name: /newsletter/ });
  const submit = page.getByRole("button", { name: "Accept terms & show instructions", exact: true });
  const submissions: { expectedRevision: number }[] = [];
  page.on("request", request => {
    if (request.url().endsWith("/api/demo/enroll")) submissions.push(request.postDataJSON());
  });
  const saved = () => page.evaluate(async () => {
    const { token } = JSON.parse(localStorage.getItem("wikicontext.reader.auth")!);
    const response = await fetch("/api/demo/preferences", { headers: { Authorization: token } });
    return response.json();
  });
  await terms.check(); await sales.check(); await submit.click();
  await expectInstructions(page);
  await expect(sales).toBeChecked(); await expect(newsletter).not.toBeChecked();
  const first = await saved();
  expect(first).toMatchObject({ salesContact: true, newsletter: false });
  await page.reload();
  await expect(sales).toBeChecked(); await expect(newsletter).not.toBeChecked();
  await expect(terms).not.toBeChecked();
  await expectConsentGate(page);
  await submit.click(); await expect(terms).toBeFocused();
  expect(submissions).toHaveLength(1);
  await terms.check(); await sales.uncheck(); await newsletter.check(); await submit.click();
  await expect.poll(async () => (await saved()).newsletter).toBe(true);
  const second = await saved();
  expect(second).toMatchObject({ salesContact: false, newsletter: true });
  expect(second.revision).toBeGreaterThan(first.revision);
  expect(submissions[1].expectedRevision).toBe(first.revision);
  await sales.check(); await newsletter.uncheck(); await submit.click();
  await expect.poll(async () => (await saved()).salesContact).toBe(true);
  const third = await saved();
  expect(third).toMatchObject({ salesContact: true, newsletter: false });
  expect(submissions[2].expectedRevision).toBe(second.revision);
  await page.locator(".enrollment-card").screenshot({ path: "/tmp/wikicontext-demo-enrolled-consent-card.png" });
  await page.route("**/api/demo/enroll", route => route.fulfill({ status: 409, json: { message: "Synthetic conflict" } }));
  await newsletter.check(); await submit.click();
  await expect(page.getByRole("status").filter({ hasText: "preferences changed elsewhere" })).toBeVisible();
  await expect(terms).not.toBeChecked(); await expect(newsletter).not.toBeChecked();
  await expect(submit).toBeEnabled(); expect(submissions).toHaveLength(4);
  await expectConsentGate(page);
  await page.unroute("**/api/demo/enroll");
  await page.locator("summary").filter({ hasText: "Manage contact permissions" }).click();
  await page.getByRole("button", { name: "Withdraw both marketing permissions", exact: true }).click();
  await expect(sales).not.toBeChecked(); await expect(newsletter).not.toBeChecked();
  await expect(terms).not.toBeChecked(); await expect(submit).toBeEnabled();
  const withdrawn = await saved();
  expect(withdrawn).toMatchObject({ salesContact: false, newsletter: false });
  expect(withdrawn.revision).toBeGreaterThan(third.revision);
  await terms.check(); await submit.click();
  await expect.poll(() => submissions.length).toBe(5);
  expect(submissions[4].expectedRevision).toBe(withdrawn.revision);
  await expect.poll(async () => (await saved()).revision).toBeGreaterThan(withdrawn.revision);
});

test("restored enrollment and direct destinations require fresh consent and an explicit destination", async ({ page, request }) => {
  await page.goto("/");
  await signIn(page, request, "returning-enrolled");
  const terms = page.getByRole("checkbox", { name: /I accept the demo terms/ });
  const sales = page.getByRole("checkbox", { name: /commercial offers/ });
  const newsletter = page.getByRole("checkbox", { name: /newsletter/ });
  const submit = page.getByRole("button", { name: "Accept terms & show instructions", exact: true });
  await terms.check(); await sales.check(); await submit.click();
  await expectInstructions(page);
  for (const destination of ["/", "/#/", "/#/page/private-observatory", "/#/setup"]) {
    await page.goto(destination);
    await page.reload();
    await expect(sales).toBeChecked();
    await expect(newsletter).not.toBeChecked();
    await expectConsentGate(page);
    await expect(page.locator("#enrollment-card")).toBeFocused();
    await expect(page.getByRole("heading", { name: "Review your choices.", exact: true })).toBeInViewport();
    await submit.click();
    await expect(terms).toBeFocused();
    await expectConsentGate(page);
    await terms.check(); await submit.click();
    await expectInstructions(page);
    await expect(page.locator("#setup")).toBeFocused();
    await expect(page.locator("#setup")).toBeInViewport();
  }
  await expect(page.getByLabel("Coding-agent setup instructions")).toBeVisible();
  await expect(page.locator(".sidebar")).toHaveCount(0);
  await page.locator("#setup summary").filter({ hasText: "Read your cited wiki" }).click();
  await page.getByRole("link", { name: "Open your wiki", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your wiki is empty — for now" })).toBeVisible();
  await page.getByRole("link", { name: "Demo setup", exact: true }).click();
  await expectConsentGate(page);
  await expect(page.locator("#enrollment-card")).toBeFocused();
  await expect(page.getByRole("heading", { name: "Review your choices.", exact: true })).toBeInViewport();
  await expect(sales).toBeChecked();
  await terms.check();
  await page.getByRole("button", { name: "Accept terms & open wiki", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your wiki is empty — for now" })).toBeVisible();
  await page.reload();
  await expect(sales).toBeChecked();
  await expectConsentGate(page);
});

for (const destination of ["show instructions", "open wiki"] as const) {
  test(`accept terms and ${destination} navigates only after enrollment succeeds`, async ({ page, request }) => {
    await page.goto("/");
    await expectSignedOutChoices(page);
    await signIn(page, request, destination === "show instructions" ? "pending-instructions" : "pending-wiki");
    const terms = page.getByRole("checkbox", { name: /I accept the demo terms/ });
    const submit = page.getByRole("button", { name: `Accept terms & ${destination}`, exact: true });
    let submissions = 0;
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route("**/api/demo/enroll", async route => {
      submissions++;
      await held;
      await route.continue();
    });
    try {
      await submit.click();
      await expect(terms).toBeFocused();
      expect(submissions).toBe(0);
      await terms.check();
      await submit.click();
      await expect.poll(() => submissions).toBe(1);
      await expect(page.getByLabel("Coding-agent setup instructions")).toHaveCount(0);
      await expect(page.locator(".sidebar")).toHaveCount(0);
      await expect(submit).toBeDisabled();
      release();
      if (destination === "show instructions") {
        await expectInstructions(page);
        await expect(page.locator("#setup")).toBeFocused();
      } else {
        await expect(page.getByRole("heading", { name: "Your wiki is empty — for now" })).toBeVisible();
        await expect(page.getByLabel("Coding-agent setup instructions")).toHaveCount(0);
      }
    } finally {
      release();
    }
  });
}

test("saved optional choices are visible before daily terms acceptance", async ({ page, request }) => {
  await page.route("**/api/demo/preferences", route => route.fulfill({
    json: { revision: 2, salesContact: true, newsletter: false },
  }));
  await page.goto("/");
  await signIn(page, request, "saved-preferences");
  const notice = page.getByText("Your saved preferences are shown. Review them before submitting changes.", { exact: true });
  await expect(notice).toBeVisible();
  const choices = page.locator(".enrollment-card legend");
  await expect(choices).toBeVisible();
  expect(await notice.evaluate(element => !!(element.compareDocumentPosition(document.querySelector(".enrollment-card legend")!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBeTruthy();
  await expect(page.getByRole("checkbox", { name: /commercial offers/ })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: /newsletter/ })).not.toBeChecked();
  await expect(page.getByRole("checkbox", { name: /I accept the demo terms/ })).not.toBeChecked();
  await expect(page.getByRole("button", { name: "Accept terms & show instructions", exact: true })).toBeEnabled();
});

test("mobile layout, legal pages, unavailable and reset states", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Your sources/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await expect(page.getByRole("button", { name: /Switch to .* theme/ })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Explore the demo" })).toBeInViewport();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const onboarding = await page.locator("#start").boundingBox();
  const workflow = await page.locator("#how").boundingBox();
  expect(onboarding && workflow && onboarding.y + onboarding.height <= workflow.y).toBeTruthy();
  const legal = await request.get("/terms/"); expect(legal.ok()).toBeTruthy();
  expect(await legal.text()).toContain("00:00 UTC");
  await signIn(page, request, "mobile");
  await expect(page.getByRole("heading", { name: "Review your choices.", exact: true })).toBeVisible();
  await expect(page.locator(".enrollment-card legend")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.getByRole("checkbox", { name: /I accept the demo terms/ }).check();
  await page.getByRole("button", { name: "Accept terms & show instructions", exact: true }).click();
  await expectInstructions(page);
  await expect(page.getByLabel("Coding-agent setup instructions")).toBeVisible();
  const help = page.locator(".codespaces-help");
  await expect(help).toBeVisible();
  await expect(help).toContainText(new URL(page.url()).origin);
  await expect(help.getByRole("button", { name: "Copy setup prompt", exact: true })).toBeVisible();
  await help.locator("summary").first().click();
  await expect(help).toContainText("gh codespace ports forward 8765:8765");
  await help.locator("summary").last().click();
  await page.setViewportSize({ width: 320, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.setViewportSize({ width: 390, height: 844 });
  const publishStep = page.locator("#setup summary").filter({ hasText: "Publish a sample document" });
  await publishStep.focus();
  await page.keyboard.press("Enter");
  await expect(publishStep.locator("..")).toHaveAttribute("open", "");
  await page.keyboard.press("Tab");
  const readStep = page.locator("#setup summary").filter({ hasText: "Read your cited wiki" });
  await readStep.focus();
  await page.keyboard.press("Enter");
  await expect(readStep.locator("..")).toHaveAttribute("open", "");
  await expect(page.locator("#setup").getByRole("link", { name: "Open your wiki", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.screenshot({ path: "/tmp/wikicontext-demo-mobile.png", fullPage: true });
  await page.route("**/api/demo/status", async route => {
    const response = await route.fetch();
    await route.fulfill({ json: { ...await response.json(), clientReady: false, installation: null } });
  });
  await page.goto("/#/setup");
  await page.reload();
  await expectConsentGate(page);
  await page.getByRole("checkbox", { name: /I accept the demo terms/ }).check();
  await page.getByRole("button", { name: "Accept terms & show instructions", exact: true }).click();
  await expect(page.getByText("Coding-agent setup is temporarily unavailable.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Coding-agent setup instructions")).toHaveCount(0);
  await page.unroute("**/api/demo/status");
  await page.getByRole("button", { name: "Accept terms & open wiki", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your wiki is empty — for now" })).toBeVisible();
  // A live service fence immediately removes private reader state.
  await page.route("**/api/context/query", route => route.fulfill({ status: 503, json: { message: "Resetting" } }));
  await page.route("**/api/demo/status", route => route.fulfill({ status: 503, json: { message: "Resetting" } }));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByText("The demo is resetting. Sign-in returns after the reset.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Google", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => localStorage.getItem("wikicontext.reader.auth"))).toBeNull();
  await page.unroute("**/api/demo/status");
  await page.route("**/api/demo/status", route => route.fulfill({ status: 200, json: { enabled: true, generation: "invalid" } }));
  await page.reload();
  await expect(page.getByText("Live demo unavailable. Nothing is saved on this page.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Google", exact: true })).toBeDisabled();
});

// The Google navigation alone is intercepted: PocketBase's real callback,
// realtime subscription, PKCE exchange and auth-store writes remain exercised.
async function mockGoogle(context: import('@playwright/test').BrowserContext, request: APIRequestContext, name: string) {
  await context.route('https://accounts.google.com/**', async route => {
    const url = new URL(route.request().url());
    const response = await request.post(process.env.WIKICONTEXT_TEST_CONTROL + '/oauth-code?' + new URLSearchParams({
      name, challenge: url.searchParams.get('code_challenge')!,
    }));
    expect(response.ok()).toBeTruthy();
    const { code } = await response.json();
    const callback = new URL(url.searchParams.get('redirect_uri')!);
    callback.searchParams.set('code', code);
    callback.searchParams.set('state', url.searchParams.get('state')!);
    await route.fulfill({ status: 302, headers: { location: callback.href } });
  });
}

test('Google popup callback persists login and localStorage.clear signs out other tabs', async ({ page, context, request }) => {
  await mockGoogle(context, request, 'popup');
  await page.goto('/#/page/preserved-destination');
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Continue with Google', exact: true }).click();
  const popup = await popupPromise;
  await expect(page.getByRole('checkbox', { name: /I accept the demo terms/ })).toBeEnabled();
  await expect.poll(() => popup.isClosed()).toBeTruthy();
  await expect(page.locator("#enrollment-card")).toBeFocused();
  await expect(page.getByRole("heading", { name: "Review your choices.", exact: true })).toBeInViewport();
  await expectConsentGate(page);
  expect(await page.evaluate(() => !!JSON.parse(localStorage.getItem('wikicontext.reader.auth')!).token)).toBeTruthy();
  await page.reload();
  await expect(page.getByRole('checkbox', { name: /I accept the demo terms/ })).toBeEnabled();
  await expect(page).toHaveURL(/#\/page\/preserved-destination$/);
  const peer = await context.newPage();
  await peer.goto('/');
  await expect(peer.getByRole('checkbox', { name: /I accept the demo terms/ })).toBeEnabled();
  await peer.evaluate(() => localStorage.clear());
  await expect(page.getByRole('button', { name: 'Continue with Google', exact: true })).toBeVisible();
  await expectSignedOutChoices(page);
});

test('Google login for an already enrolled visitor still requires consent and destination selection', async ({ page, context, request }) => {
  await page.goto('/');
  await signIn(page, request, 'returning-popup');
  await page.getByRole('checkbox', { name: /I accept the demo terms/ }).check();
  await page.getByRole('checkbox', { name: /newsletter/ }).check();
  await page.getByRole('button', { name: "Accept terms & show instructions", exact: true }).click();
  await expectInstructions(page);
  await page.getByRole('button', { name: 'Sign out of this browser', exact: true }).click();
  await mockGoogle(context, request, 'returning-popup');
  await page.goto('/#/page/preserved-destination');
  await page.getByRole('button', { name: 'Continue with Google', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: /newsletter/ })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /commercial offers/ })).not.toBeChecked();
  await expectConsentGate(page);
  await page.getByRole('checkbox', { name: /I accept the demo terms/ }).check();
  await page.getByRole('button', { name: "Accept terms & open wiki", exact: true }).click();
  await expect(page).toHaveURL(/#\/page\/preserved-destination$/);
  await expect(page.getByRole('heading', { name: 'Your wiki is empty — for now' })).toBeVisible();
});

test('OAuth completion survives nginx while exchange is pending and administration stays blocked', async ({ page, context, request }) => {
  await mockGoogle(context, request, 'completion-ingress');
  // Hold only this completion document open for inspection. The separate
  // normal popup test verifies the real self-close needed after COOP navigation.
  await context.addInitScript(() => {
    if (location.hash === '#/auth/oauth2-redirect-success') {
      (window as Window & { completionCloseAttempts?: number }).completionCloseAttempts = 0;
      window.close = () => {
        const callback = window as Window & { completionCloseAttempts: number };
        callback.completionCloseAttempts += 1;
      };
    }
  });
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/collections/users/auth-with-oauth2', async route => {
    await held;
    await route.continue();
  });
  try {
    await page.goto('/');
    const popupPromise = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Continue with Google', exact: true }).click();
    const popup = await popupPromise;
    await expect(popup).toHaveURL(/^http:\/\/[^/]+\/#\/auth\/oauth2-redirect-success$/);
    await expect(popup.getByRole('heading', { name: 'Return to WikiContext', exact: true })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('wikicontext.reader.auth'))).toBeNull();
    for (const path of ['/_', '/_/', '/_/index.html', '/api/collections/_superusers/auth-methods']) {
      expect((await request.get(path)).status()).toBe(404);
    }
    release();
    await expect(page.getByRole('checkbox', { name: /I accept the demo terms/ })).toBeEnabled();
    expect(await popup.evaluate(() => (window as Window & { completionCloseAttempts: number }).completionCloseAttempts)).toBeGreaterThan(0);
    await popup.close();
  } finally {
    release();
  }
});

test('OAuth callback failure through nginx has a usable inert completion page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const response = await page.goto('/api/oauth2-redirect?error=access_denied&error_description=synthetic-denial');
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/^http:\/\/[^/]+\/#\/auth\/oauth2-redirect-failure$/);
  await expect(page.getByRole('heading', { name: 'Sign-in could not complete', exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('wikicontext.reader.auth'))).toBeNull();
  await expect(page.getByRole('button', { name: 'Continue with Google', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Close this window', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Open WikiContext', exact: true })).toBeFocused();
});

test('Google login works in memory when browser storage is blocked', async ({ page, context, request }) => {
  await context.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Blocked', 'SecurityError'); } });
  });
  await mockGoogle(context, request, 'blocked-storage');
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue with Google', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: /I accept the demo terms/ })).toBeEnabled();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Continue with Google', exact: true })).toBeVisible();
});

test('blocked Google popup gives actionable retry guidance', async ({ page }) => {
  await page.addInitScript(() => { window.open = () => null; });
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue with Google', exact: true }).click();
  await expect(page.getByText('Allow the sign-in popup, then try again.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with Google', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => localStorage.getItem('wikicontext.reader.auth'))).toBeNull();
});

test('cancelling Google closes a pending provider popup', async ({ page, context }) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let reached!: () => void;
  const navigation = new Promise<void>(resolve => { reached = resolve; });
  await context.route('https://accounts.google.com/**', async route => {
    reached(); await held;
    await route.abort().catch(() => {});
  });
  await page.goto('/');
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Continue with Google', exact: true }).click();
  const popup = await popupPromise;
  await navigation;
  await page.getByRole('button', { name: 'Cancel Google sign-in', exact: true }).click();
  release();
  await expect.poll(() => popup.isClosed()).toBeTruthy();
  await expect(page.getByText('Google sign-in cancelled. You can try again.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('wikicontext.reader.auth'))).toBeNull();
});

test('Google timeout closes popup and permits another attempt', async ({ page, context }) => {
  await context.route('https://accounts.google.com/**', route => route.fulfill({ contentType: 'text/html', body: '<p>Synthetic pending Google login</p>' }));
  await page.clock.install();
  await page.goto('/');
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Continue with Google', exact: true }).click();
  const popup = await popupPromise;
  await expect(page.getByRole('button', { name: 'Cancel Google sign-in', exact: true })).toBeVisible();
  await page.clock.fastForward(180_001);
  await expect(page.getByText('Google sign-in timed out. Please try again.', { exact: true })).toBeVisible();
  await expect.poll(() => popup.isClosed()).toBeTruthy();
  await expect(page.getByRole('button', { name: 'Continue with Google', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => localStorage.getItem('wikicontext.reader.auth'))).toBeNull();
});


test('a late successful Google exchange cannot restore a cancelled session', async ({ page, context, request }) => {
  await mockGoogle(context, request, 'late-exchange');
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let exchanged!: () => void;
  const ready = new Promise<void>(resolve => { exchanged = resolve; });
  await page.route('**/api/collections/users/auth-with-oauth2', async route => {
    const response = await route.fetch();
    expect(response.ok()).toBeTruthy();
    exchanged(); await held;
    await route.fulfill({ response }).catch(() => {});
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue with Google', exact: true }).click();
  await ready;
  await page.getByRole('button', { name: 'Cancel Google sign-in', exact: true }).click();
  release();
  await expect(page.getByText('Google sign-in cancelled. You can try again.', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Continue with Google', exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('wikicontext.reader.auth'))).toBeNull();
});

for (const outcome of ['success', 'failure']) {
  test(`OAuth ${outcome} completion preserves auth storage and makes no API calls`, async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('wikicontext.reader.auth', JSON.stringify({ token: 'synthetic-expired-token', record: { id: 'synthetic' } }));
    });
    const apiRequests: string[] = [];
    page.on('request', request => {
      if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url());
    });
    await page.goto(`/#/auth/oauth2-redirect-${outcome}`);
    await expect(page.getByRole('heading', { name: outcome === 'success' ? 'Return to WikiContext' : 'Sign-in could not complete', exact: true })).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('wikicontext.reader.auth')!).token)).toBe('synthetic-expired-token');
    expect(apiRequests).toEqual([]);
  });
}
