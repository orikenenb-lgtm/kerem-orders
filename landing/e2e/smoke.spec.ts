import { test, expect, type ConsoleMessage } from "@playwright/test";

// Smoke test for the PUBLIC catalog (/view/). This is a read-only surface:
// it renders products via the anon `catalog_public` RPC against STAGING
// Supabase — no login, no ordering, no writes of any kind. The spec proves
// the catalog renders and stays clean; it never places an order or signs up.

const MIN_PRODUCTS = 12; // "at least a dozen"
const VIEWPORTS = [
  { label: "mobile", width: 390, height: 844 },
  { label: "desktop", width: 1440, height: 900 },
];

test.describe("public catalog", () => {
  test("renders a dozen products, no console errors, no horizontal overflow", async ({ page }) => {
    // Collect console errors and uncaught page errors from the first moment.
    const consoleErrors: string[] = [];
    page.on("console", (msg: ConsoleMessage) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

    await page.setViewportSize(VIEWPORTS[1]); // start desktop
    await page.goto("view/", { waitUntil: "domcontentloaded" });

    // Product cards are real <button class="kt-card"> elements, each holding an
    // <h3> with the product name. Wait for the anon RPC round-trip to paint.
    const cards = page.locator(".kt-card");
    await expect(cards.first()).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(() => cards.count(), { timeout: 30_000, message: "waiting for product cards" })
      .toBeGreaterThanOrEqual(MIN_PRODUCTS);

    // At least a dozen product NAMES actually render (non-empty h3 text).
    const names = await page.locator(".kt-card h3").allInnerTexts();
    const nonEmpty = names.map((n) => n.trim()).filter((n) => n.length > 0);
    expect(
      nonEmpty.length,
      `expected >= ${MIN_PRODUCTS} product names, saw ${nonEmpty.length}`,
    ).toBeGreaterThanOrEqual(MIN_PRODUCTS);

    // ZERO horizontal overflow at both the narrow and wide breakpoints. The
    // page body must never scroll sideways (inner chip rows may, that is an
    // isolated overflow container and does not widen documentElement).
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      // Let sticky/grid layout settle after the resize.
      await page.waitForTimeout(400);
      const overflow = await page.evaluate(() => {
        const el = document.documentElement;
        return el.scrollWidth - el.clientWidth;
      });
      // <= 1px absorbs sub-pixel rounding only; anything real fails.
      expect(overflow, `horizontal overflow at ${vp.width}px (${vp.label})`).toBeLessThanOrEqual(1);
    }

    // ZERO console errors across the whole run.
    expect(consoleErrors, `console errors:\n${consoleErrors.join("\n")}`).toEqual([]);
  });
});
