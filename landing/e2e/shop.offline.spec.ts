import { test, expect, type ConsoleMessage } from "@playwright/test";
import {
  mockSupabase, seedSession, PRODUCTS, SEEDED_CART_TOTAL, ORDER,
} from "./mockSupabase";

// The shop's "do not break this" guarantees, proved OFFLINE.
//
// smoke.spec.ts exercises the real staging data surface but needs network
// access to *.supabase.co, which CI and the build container do not have — so it
// cannot be the regression gate. These specs mock Supabase entirely and
// therefore run anywhere, on every branch, with no credentials.
//
// They assert only what must hold whatever the feature flags are set to: the
// catalogue renders, the cart adds up, the order history renders, nothing logs
// an error, and nothing scrolls sideways. Flag-specific behaviour is asserted
// conditionally, so the suite is green with the flags off (today) and stays
// green as they are switched on.
//
// Nothing here signs up, orders, or writes anything anywhere.

const VIEWPORTS = [
  { label: "mobile", width: 390, height: 844 },
  { label: "desktop", width: 1440, height: 900 },
];

// A few console messages are environment noise, not defects: the mocked auth
// token is not a real JWT, and fonts/service files can 404 offline.
const IGNORED = [/favicon/i, /manifest/i, /font/i, /Failed to load resource/i];
const realError = (t: string) => !IGNORED.some((re) => re.test(t));

function watchErrors(page: import("@playwright/test").Page): string[] {
  const errors: string[] = [];
  page.on("console", (m: ConsoleMessage) => {
    if (m.type() === "error" && realError(m.text())) errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

const overflowOf = (page: import("@playwright/test").Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const vp of VIEWPORTS) {
  test.describe(`${vp.label} (${vp.width}px)`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, locale: "he-IL" });

    test("catalogue renders products, no errors, no sideways scroll", async ({ context, page }) => {
      await mockSupabase(context);
      await seedSession(context);
      const errors = watchErrors(page);

      await page.goto("/catalog/", { waitUntil: "domcontentloaded" });
      const cards = page.locator(".kt-card");
      await expect(cards.first()).toBeVisible({ timeout: 30_000 });
      await expect.poll(() => cards.count(), { timeout: 20_000 }).toBeGreaterThanOrEqual(8);

      // Every card carries a real, non-empty product name.
      const names = (await page.locator(".kt-card h3").allInnerTexts()).map((n) => n.trim());
      expect(names.filter(Boolean).length).toBeGreaterThanOrEqual(8);
      expect(names).toContain(PRODUCTS[0].name);

      expect(await overflowOf(page), "horizontal overflow").toBeLessThanOrEqual(1);
      expect(errors, errors.join("\n")).toEqual([]);
    });

    test("cart drawer opens and its total matches the lines", async ({ context, page }) => {
      await mockSupabase(context);
      await seedSession(context);
      const errors = watchErrors(page);

      await page.goto("/catalog/", { waitUntil: "domcontentloaded" });
      await expect(page.locator(".kt-card").first()).toBeVisible({ timeout: 30_000 });

      await page.locator('button[aria-haspopup="dialog"]').first().click();
      const drawer = page.getByRole("dialog", { name: "עגלת הקניות" });
      await expect(drawer).toBeVisible();

      // Both seeded lines are listed, and the drawer shows the exact total.
      await expect(drawer.getByText(PRODUCTS[0].name, { exact: false })).toBeVisible();
      await expect(drawer.getByText(PRODUCTS[2].name, { exact: false })).toBeVisible();
      const money = SEEDED_CART_TOTAL.toLocaleString("he-IL", { minimumFractionDigits: 2 });
      await expect(drawer.getByText(`₪${money}`).first()).toBeVisible();

      // Below the ₪3,500 minimum, checkout must stay disabled — the single most
      // important thing the cart does.
      const submit = drawer.getByRole("button", { name: /שליחת הזמנה/ });
      await expect(submit).toBeDisabled();

      expect(await overflowOf(page), "horizontal overflow").toBeLessThanOrEqual(1);
      expect(errors, errors.join("\n")).toEqual([]);
    });

    test("order history renders a past order", async ({ context, page }) => {
      await mockSupabase(context);
      await seedSession(context);
      const errors = watchErrors(page);

      await page.goto("/account/", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: "ההזמנות שלי" })).toBeVisible();
      await expect(page.getByText(ORDER.order_items[0].product_name, { exact: false })).toBeVisible({ timeout: 20_000 });

      expect(await overflowOf(page), "horizontal overflow").toBeLessThanOrEqual(1);
      expect(errors, errors.join("\n")).toEqual([]);
    });
  });
}

test.describe("flag-gated behaviour (asserted only when the flag is on)", () => {
  test.use({ viewport: { width: 1440, height: 900 }, locale: "he-IL" });

  test("price buckets, when present, really narrow the grid", async ({ context, page }) => {
    await mockSupabase(context);
    await seedSession(context);
    await page.goto("/catalog/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".kt-card").first()).toBeVisible({ timeout: 30_000 });

    const bucket = page.getByRole("button", { name: "עד ₪5" });
    test.skip((await bucket.count()) === 0, "ff_filters_v2 is off");

    const before = await page.locator(".kt-card").count();
    await bucket.click();
    await expect.poll(() => page.locator(".kt-card").count(), { timeout: 15_000 }).toBeLessThan(before);
    // Only the one product under ₪5 survives the filter.
    await expect(page.locator(".kt-card h3")).toHaveText([PRODUCTS[10].name]);
  });

  test("the category toggle, when present, reveals every category", async ({ context, page }) => {
    await mockSupabase(context);
    await seedSession(context);
    await page.goto("/catalog/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".kt-card").first()).toBeVisible({ timeout: 30_000 });

    const toggle = page.getByRole("button", { name: /עוד \d+ קטגוריות/ });
    test.skip((await toggle.count()) === 0, "ff_category_sheet is off");

    const chips = page.locator('[aria-label="סינון לפי קטגוריה"] button');
    const collapsed = await chips.count();
    await toggle.click();
    // 24 categories + the "הכל" chip.
    await expect.poll(() => chips.count(), { timeout: 10_000 }).toBe(25);
    expect(collapsed).toBeLessThan(25);
  });
});
