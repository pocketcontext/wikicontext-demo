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
