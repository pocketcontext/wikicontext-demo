import { expect, test, type Page, type APIRequestContext } from "@playwright/test";

async function signIn(page: Page, request: APIRequestContext, name: string) {
  const response = await request.post(process.env.WIKICONTEXT_TEST_CONTROL + "/session/" + name);
  expect(response.ok()).toBeTruthy();
  const session = await response.json();
  // OAuth exchange is performed against the synthetic provider by the fixture;
  // only the external popup is excluded from this local browser test.
  await page.evaluate(value => localStorage.setItem("wikicontext.reader.auth", JSON.stringify(value)), session);
  await page.reload();
  await expect(page.getByRole("checkbox", { name: /I accept the demo terms/ })).toBeVisible();
}

test("daily consent, conflicts, agent setup and private live reader", async ({ page, request, context }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/#/page/private-observatory");
  await expect(page.getByRole("button", { name: "Continue with Google", exact: true })).toBeEnabled();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.screenshot({ path: "/tmp/wikicontext-demo-desktop.png", fullPage: true });
  await signIn(page, request, "reader");
  const terms = page.getByRole("checkbox", { name: /I accept the demo terms/ });
  const submit = page.getByRole("button", { name: /Accept terms/ });
  await expect(submit).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: /commercial offers/ })).not.toBeChecked();
  await expect(page.getByRole("checkbox", { name: /newsletter/ })).not.toBeChecked();
  let submissions = 0;
  await page.route("**/api/demo/enroll", async route => {
    submissions++;
    if (submissions === 1) await route.fulfill({ status: 409, json: { message: "Synthetic conflict" } });
    else await route.continue();
  });
  await terms.check(); await submit.click();
  await expect(page.getByRole("status").filter({ hasText: "preferences changed elsewhere" })).toBeVisible();
  await expect(terms).not.toBeChecked();
  await expect(submit).toBeDisabled();
  expect(submissions).toBe(1);
  await terms.check(); await submit.click();
  await expect(page.getByRole("heading", { name: "Connect your coding agent.", exact: true })).toBeVisible();
  await expect(page.locator("#setup")).toBeFocused();
  await expect(page.getByLabel("Coding-agent setup instructions")).toContainText("reader@example.test");
  await expect(page.getByLabel("Coding-agent setup instructions")).toContainText("wikicontext-demo");
  await expect(page.getByRole("table", { name: "Today’s usage and daily limits" })).toBeVisible();
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
  await page.getByRole("link", { name: "Open your wiki" }).click();
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
  await expect(peer.getByRole("heading", { name: "Private observatory", exact: true })).toBeVisible();
  await peer.evaluate(() => localStorage.removeItem("wikicontext.reader.auth"));
  await expect(page.getByRole("button", { name: "Continue with Google", exact: true })).toBeVisible();
  await expect(page.getByText("Private starlight observation.", { exact: false })).toHaveCount(0);
  await signIn(page, request, "other");
  await terms.check(); await submit.click();
  await page.getByRole("link", { name: "Open your wiki" }).click();
  await expect(page.getByRole("heading", { name: "Your wiki is empty — for now" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Private observatory", exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("mobile layout, legal pages, unavailable and reset states", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Your sources/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.getByRole("button", { name: /Switch to light theme/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const legal = await request.get("/terms/"); expect(legal.ok()).toBeTruthy();
  expect(await legal.text()).toContain("00:00 UTC");
  await signIn(page, request, "mobile");
  await page.getByRole("checkbox", { name: /I accept the demo terms/ }).check();
  await page.getByRole("button", { name: /Accept terms/ }).click();
  await expect(page.getByLabel("Coding-agent setup instructions")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.screenshot({ path: "/tmp/wikicontext-demo-mobile.png", fullPage: true });
  await page.route("**/api/demo/status", async route => {
    const response = await route.fetch();
    await route.fulfill({ json: { ...await response.json(), clientReady: false, installation: null } });
  });
  await page.goto("/#/setup");
  await page.reload();
  await expect(page.getByText("Coding-agent setup is temporarily unavailable.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Coding-agent setup instructions")).toHaveCount(0);
  await page.unroute("**/api/demo/status");
  await page.getByRole("link", { name: "Open your wiki" }).click();
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
  await expect(page.getByRole('checkbox', { name: /I accept the demo terms/ })).toBeVisible();
  await expect.poll(() => popup.isClosed()).toBeTruthy();
  expect(await page.evaluate(() => !!JSON.parse(localStorage.getItem('wikicontext.reader.auth')!).token)).toBeTruthy();
  await page.reload();
  await expect(page.getByRole('checkbox', { name: /I accept the demo terms/ })).toBeVisible();
  await expect(page).toHaveURL(/#\/page\/preserved-destination$/);
  const peer = await context.newPage();
  await peer.goto('/');
  await expect(peer.getByRole('checkbox', { name: /I accept the demo terms/ })).toBeVisible();
  await peer.evaluate(() => localStorage.clear());
  await expect(page.getByRole('button', { name: 'Continue with Google', exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /I accept the demo terms/ })).toHaveCount(0);
});

test('Google login works in memory when browser storage is blocked', async ({ page, context, request }) => {
  await context.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Blocked', 'SecurityError'); } });
  });
  await mockGoogle(context, request, 'blocked-storage');
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue with Google', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: /I accept the demo terms/ })).toBeVisible();
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
