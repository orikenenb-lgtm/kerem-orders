import { test, expect, devices, type Browser, type Page } from "@playwright/test";
import { BY_SKU, callsOf, mockInventory, newInvState, seedDraftCount, seedEditRequest, type InvState } from "./mockInventory";

// Stock count (ספירת מלאי), proved OFFLINE: every Supabase / edge-function
// call is answered by e2e/mockInventory.ts. Nothing reaches Supabase or Rivhit.

const SHOTS = process.env.INV_SHOTS_DIR
  ?? "/tmp/claude-0/-home-user-kerem-orders/e82c3836-381c-5c3b-b665-cf77d1402997/scratchpad/inv/shots";

// iPhone 13 metrics on the project's Chromium (the descriptor's webkit default is dropped).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { defaultBrowserType: _webkit, ...IPHONE_13 } = devices["iPhone 13"];

const IGNORED = [/favicon/i, /manifest/i, /font/i, /Failed to load resource/i];

async function open(browser: Browser, baseURL: string | undefined, s: InvState, role: "manager" | "customer" | "guest" = "manager", phone = true) {
  const context = await browser.newContext({ ...(phone ? IPHONE_13 : { viewport: { width: 1280, height: 900 } }), locale: "he-IL", baseURL });
  await mockInventory(context, s, role);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error" && !IGNORED.some((re) => re.test(m.text()))) errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  // Dialogs are accepted unless a test sets dialogs.answer = false; every text is kept.
  const dialogs = { answer: true, seen: [] as string[] };
  page.on("dialog", (d) => { dialogs.seen.push(d.message()); void (dialogs.answer ? d.accept() : d.dismiss()); });
  return { context, page, errors, dialogs };
}

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const scanInput = (page: Page) => page.getByTestId("inv-scan-input");
const qtyInput = (page: Page) => page.getByTestId("inv-qty");
const card = (page: Page) => page.getByTestId("inv-item-card");

/** A wedge scanner: fast keystrokes into the focused scan field, then Enter. */
async function wedge(page: Page, code: string) {
  await scanInput(page).focus();
  await page.keyboard.type(code, { delay: 8 });
  await page.keyboard.press("Enter");
}

async function startCount(page: Page) {
  await page.goto("admin/inventory/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "ספירה חדשה" }).click();
  await expect(page).toHaveURL(/count=[0-9a-f-]{36}&view=count/);
  await expect(page.getByTestId("inv-counter")).toHaveText("נספרו 0 פריטים");
}

test.describe("access", () => {
  test("a guest is sent to /login", async ({ browser, baseURL }) => {
    const { context, page } = await open(browser, baseURL, newInvState(), "guest");
    await page.goto("admin/inventory/", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/login\/?/, { timeout: 15_000 });
    await expect(page.getByText("ספירה חדשה")).toHaveCount(0);
    await context.close();
  });

  test("a customer is sent away from /admin/inventory", async ({ browser, baseURL }) => {
    const s = newInvState();
    const { context, page } = await open(browser, baseURL, s, "customer");
    await page.goto("admin/inventory/", { waitUntil: "domcontentloaded" });
    await expect(page).not.toHaveURL(/admin\/inventory/, { timeout: 15_000 });
    await expect(page.getByText("ספירה חדשה")).toHaveCount(0);
    expect(s.calls.filter((c) => c.name.startsWith("inv_") || c.name.startsWith("sync:"))).toHaveLength(0);
    await context.close();
  });

  test("the manager sees the entry row in ניהול ← קטלוג", async ({ browser, baseURL }) => {
    const { context, page } = await open(browser, baseURL, newInvState(), "manager", false);
    await page.goto("admin/", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "קטלוג" }).click();
    const link = page.getByRole("link", { name: /פתיחת ספירת מלאי/ });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", /\/admin\/inventory\/?$/);
    await context.close();
  });
});

test.describe("manager on an iPhone 13", () => {
  test("new count → wedge scan → quantity → save; unknown, duplicate, leading zero, re-scan", async ({ browser, baseURL }) => {
    const s = newInvState();
    const { context, page, errors } = await open(browser, baseURL, s);

    await page.goto("admin/inventory/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("inv-sim-banner")).toContainText("מצב סימולציה");
    // One storage → no warehouse choice.
    await expect(page.getByRole("combobox")).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/1-start-phone.png`, fullPage: true });
    expect(await overflow(page)).toBeLessThanOrEqual(1);

    await page.getByRole("button", { name: "ספירה חדשה" }).click();
    await expect(page.getByTestId("inv-counter")).toHaveText("נספרו 0 פריטים");
    const open1 = callsOf(s, "inv_open_count")[0].args;
    expect(open1.p_storage_id).toBeNull();

    // --- scan → quantity → save
    const robot = BY_SKU("6928810168960");
    await wedge(page, robot.sku);
    await expect(card(page)).toContainText(robot.name);
    await expect(card(page)).toContainText("כמות רשומה ברווחית: 40");
    await expect(qtyInput(page)).toBeFocused();
    await page.screenshot({ path: `${SHOTS}/2-item-card-phone.png`, fullPage: true });
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    await page.keyboard.type("42", { delay: 120 });
    await page.getByRole("button", { name: "שמור והמשך" }).click();
    await expect(page.getByRole("status").filter({ hasText: "נשמר" })).toContainText(`נשמר: ${robot.name} — 42`);
    await expect(page.getByTestId("inv-counter")).toHaveText("נספרו 1 פריטים");
    await expect(scanInput(page)).toBeFocused();
    expect(s.lines).toHaveLength(1);
    expect(s.lines[0].counted_qty).toBe(42);
    // R3: Rivhit's own quantity is captured right after the save.
    await expect(page.getByTestId("inv-verify")).toHaveText("✓ אומת מול רווחית");
    expect(callsOf(s, "sync:capture_baseline")[0].args).toMatchObject({ line_id: s.lines[0].id, expected_version: 1 });
    expect(s.lines[0].rivhit_baseline_qty).toBe(40);

    // --- pack helper
    await wedge(page, "6928817371677");
    await expect(card(page)).toContainText("מארז = 12 יח׳");
    await page.getByRole("button", { name: "ביטול" }).click();

    // --- unknown code
    await wedge(page, "1234567890128");
    await expect(page.getByRole("alert").filter({ hasText: "ברקוד לא נמצא" })).toContainText("1234567890128");
    await expect(card(page)).toHaveCount(0);

    // --- duplicate code: a chooser, never a silent pick
    await wedge(page, "7290000000017");
    const chooser = page.getByRole("group", { name: "בחירת פריט" });
    await expect(chooser).toContainText("יש 2 פריטים");
    await expect(card(page)).toHaveCount(0);
    await chooser.getByRole("button", { name: /סליים לוחמים כחול/ }).click();
    await expect(card(page)).toContainText("סליים לוחמים כחול");
    await page.getByRole("button", { name: "ביטול" }).click();

    // --- leading zeros stay text, end to end
    await wedge(page, "0071234567892");
    await expect(card(page)).toContainText("כדור גומי סטיץ");
    const lk = callsOf(s, "inv_lookup").at(-1)!.args;
    expect(lk.p_code).toBe("0071234567892");
    await page.keyboard.type("30", { delay: 100 });
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("inv-counter")).toHaveText("נספרו 2 פריטים");
    expect(callsOf(s, "inv_save_line").at(-1)!.args.p_code).toBe("0071234567892");

    // --- a scanner burst into the (empty) quantity field is a scan, not a quantity
    await wedge(page, "6924050751115");
    await expect(card(page)).toContainText("מסוק מכבי אש");
    await expect(qtyInput(page)).toBeFocused();
    await page.keyboard.type("6928817371677", { delay: 5 });
    await page.keyboard.press("Enter");
    await expect(card(page)).toContainText("פרוזן בדיספלאי");
    await expect(qtyInput(page)).toHaveValue("");
    // …and with a quantity already typed, the scan is refused and the quantity kept.
    await page.keyboard.type("5", { delay: 150 });
    await page.keyboard.type("6924050751115", { delay: 5 });
    await page.keyboard.press("Enter");
    await expect(page.getByRole("alert").filter({ hasText: "יש כמות שלא נשמרה" })).toBeVisible();
    await expect(qtyInput(page)).toHaveValue("5");
    await expect(card(page)).toContainText("פרוזן בדיספלאי");
    expect(s.lines).toHaveLength(2);
    await page.getByRole("button", { name: "ביטול" }).click();

    // --- re-scan of a counted item: explicit replace vs add
    await wedge(page, robot.sku);
    await expect(page.getByTestId("inv-saved-qty")).toHaveText("42");
    await expect(page.getByRole("button", { name: "שמור והמשך" })).toBeDisabled();
    await page.getByRole("button", { name: "הוספה לכמות" }).click();
    await qtyInput(page).fill("8");
    await expect(page.getByTestId("inv-add-total")).toContainText("= 50");
    await page.getByRole("button", { name: "שמור והמשך" }).click();
    await expect(page.getByRole("status").filter({ hasText: "נשמר" })).toContainText("50");
    expect(s.lines.find((l) => l.product_id === robot.id)!.counted_qty).toBe(50);

    await wedge(page, robot.sku);
    await expect(page.getByTestId("inv-saved-qty")).toHaveText("50");
    await page.getByRole("button", { name: "החלפת הכמות" }).click();
    await qtyInput(page).fill("45");
    await page.getByRole("button", { name: "שמור והמשך" }).click();
    await expect(page.getByRole("status").filter({ hasText: "נשמר" })).toContainText("45");
    expect(s.lines.find((l) => l.product_id === robot.id)!.counted_qty).toBe(45);
    await expect(page.getByTestId("inv-counter")).toHaveText("נספרו 2 פריטים");

    // --- the list view
    await page.getByRole("button", { name: /רשימה/ }).click();
    await expect(page.getByText(robot.name)).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(1);

    expect(errors).toEqual([]);
    await context.close();
  });

  test("a failed save keeps the value on the device, survives a refresh, and retry works", async ({ browser, baseURL }) => {
    const s = newInvState();
    const { context, page } = await open(browser, baseURL, s);
    await startCount(page);

    await wedge(page, "6924050751115");
    await expect(card(page)).toContainText("מסוק");
    s.failSaves = 1;
    await qtyInput(page).fill("7");
    await page.getByRole("button", { name: "שמור והמשך" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "השמירה נכשלה" })).toContainText("השמירה נכשלה — הערך נשמר במכשיר");
    await expect(qtyInput(page)).toHaveValue("7");
    expect(s.lines).toHaveLength(0);
    const stored = await page.evaluate(() => localStorage.getItem("kt_inv_pending_v1"));
    expect(JSON.parse(stored!)[0]).toMatchObject({ qty: 7, expectedVersion: null });
    await page.screenshot({ path: `${SHOTS}/3-save-failed-phone.png`, fullPage: true });

    // Leave and come back: the unsaved value is still offered.
    await page.reload({ waitUntil: "domcontentloaded" });
    const banner = page.getByRole("alert", { name: "ערכים שלא נשמרו בשרת" });
    await expect(banner).toContainText("מסוק מכבי אש");
    await expect(banner).toContainText("7");
    s.captureFails = true; // the Rivhit check fails — the save must still stand
    await banner.getByRole("button", { name: "נסו שוב" }).click();
    await expect(page.getByRole("status").filter({ hasText: "נשמר" })).toContainText("7");
    await expect(page.getByTestId("inv-verify")).toHaveText("לא אומת — ייבדק באישור");
    await expect(page.getByTestId("inv-counter")).toHaveText("נספרו 1 פריטים");
    expect(s.lines[0].counted_qty).toBe(7);
    expect(await page.evaluate(() => localStorage.getItem("kt_inv_pending_v1"))).toBeNull();
    await context.close();
  });

  test("a conflict shows the other manager's value and lets the user choose", async ({ browser, baseURL }) => {
    const s = newInvState();
    const id = seedDraftCount(s, [["6928810168960", 42]]);
    const { context, page } = await open(browser, baseURL, s);
    await page.goto(`admin/inventory/?count=${id}&view=count`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("inv-counter")).toHaveText("נספרו 1 פריטים");

    await wedge(page, "6928810168960");
    await expect(page.getByTestId("inv-saved-qty")).toHaveText("42");
    // Another manager saves 99 meanwhile.
    Object.assign(s.lines[0], { counted_qty: 99, version: 2 });
    await page.getByRole("button", { name: "החלפת הכמות" }).click();
    await qtyInput(page).fill("10");
    await page.getByRole("button", { name: "שמור והמשך" }).click();
    const box = page.getByRole("alert").filter({ hasText: "מנהל אחר עדכן" });
    await expect(page.getByTestId("inv-conflict-theirs")).toHaveText("99");
    await expect(box).toContainText("רציתם לשמור 10");
    expect(s.lines[0].counted_qty).toBe(99);
    await box.getByRole("button", { name: /להחליף ל-10/ }).click();
    await expect(page.getByRole("status").filter({ hasText: "נשמר" })).toContainText("10");
    expect(s.lines[0].counted_qty).toBe(10);
    expect(s.lines[0].version).toBe(3);
    await context.close();
  });

  test("review: diffs highlighted, uncounted note, approve once (double click), recount a changed line", async ({ browser, baseURL }) => {
    const s = newInvState();
    // robot 40→42 (+2), helicopter 10→50 (+40, highlighted), frozen 120→100 (-20, highlighted)
    const id = seedDraftCount(s, [["6928810168960", 42], ["6924050751115", 50], ["6928817371677", 100]]);
    s.changedOnSync.add(BY_SKU("6928810168960").id);
    const { context, page, errors } = await open(browser, baseURL, s);
    await page.goto(`admin/inventory/?count=${id}&view=review`, { waitUntil: "domcontentloaded" });

    const table = page.getByTestId("inv-review-table");
    await expect(table.getByRole("columnheader")).toHaveText(["פריט", "כמות ברווחית בזמן הספירה", "נספר", "הפרש"]);
    await expect(table.locator("tbody tr")).toHaveCount(3);
    await expect(table.locator("tr[data-highlight]")).toHaveCount(2);
    await expect(table.locator("tbody tr").first()).toContainText("+40");
    await expect(table).toContainText("-20");
    await expect(page.getByText("פריטים שלא נספרו לא משתנים.")).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `${SHOTS}/4-review-phone.png`, fullPage: true });

    await page.getByTestId("inv-approve").dblclick();
    await expect(page.getByTestId("inv-count-status")).toHaveText("דורש טיפול", { timeout: 15_000 });
    expect(callsOf(s, "inv_approve")).toHaveLength(1);
    expect(callsOf(s, "sync:sync_count")).toHaveLength(1);
    expect(callsOf(s, "inv_approve")[0].args.p_expected_version).toBe(1);
    await expect(page.getByTestId("inv-approve")).toHaveCount(0);
    await expect(table).toContainText("הושלם");
    await expect(table).toContainText("המלאי ברווחית השתנה מאז הספירה");

    // ספור מחדש → count view for that product only → save → continue the sync.
    await table.getByRole("button", { name: "ספור מחדש" }).click();
    await expect(card(page)).toContainText("ספירה חוזרת");
    await qtyInput(page).fill("41");
    await page.getByRole("button", { name: "שמור והמשך" }).click();
    await expect(page.getByRole("status").filter({ hasText: "נשמר" })).toContainText("41");
    await page.getByRole("button", { name: /סיכום/ }).click();
    await page.getByRole("button", { name: "המשך עדכון" }).click();
    await expect(page.getByTestId("inv-count-status")).toHaveText("הושלם", { timeout: 15_000 });
    expect(callsOf(s, "sync:sync_count")).toHaveLength(2);

    // History lists who/what.
    await page.getByRole("button", { name: "היסטוריה" }).click();
    await expect(page.getByRole("list", { name: "היסטוריית הספירה" })).toContainText("הספירה אושרה");
    await expect(page.getByRole("list", { name: "היסטוריית הספירה" })).toContainText("מנהלת בדיקה");

    expect(errors).toEqual([]);
    await context.close();
  });

  test("review shows the difference that will be SENT (Rivhit at count time), unverified lines apart", async ({ browser, baseURL }) => {
    const s = newInvState();
    // The reviewer's case: the site copy says 40, Rivhit said 42 right after the count, 40 were counted.
    const id = seedDraftCount(s, [["6928810168960", 40, 42], ["6924050751115", 12, null]]);
    const robot = BY_SKU("6928810168960");
    const heli = BY_SKU("6924050751115");
    const { context, page, errors } = await open(browser, baseURL, s);
    await page.goto(`admin/inventory/?count=${id}&view=review`, { waitUntil: "domcontentloaded" });
    const table = page.getByTestId("inv-review-table");
    const robotRow = table.locator("tbody tr", { hasText: robot.name });
    await expect(robotRow).toContainText("-2");
    await expect(robotRow).toContainText("באתר: 40");
    await expect(page.getByTestId("inv-review-summary")).toContainText("1 חוסר");
    await expect(page.getByTestId("inv-review-summary")).toContainText("0 בלי הפרש");
    await expect(page.getByTestId("inv-review-summary")).toContainText("1 לא אומתו מול רווחית");
    await expect(page.getByTestId("inv-unverified-head")).toHaveText("לא אומת מול רווחית — יסומן 'ספור מחדש' ולא יעודכן");
    const heliRow = table.locator("tr[data-unverified]");
    await expect(heliRow).toContainText(heli.name);
    await expect(heliRow).toContainText("—");
    await expect(page.getByText(/הכמות שנקראה מרווחית מיד אחרי שהפריט נספר/)).toBeVisible();

    await page.getByTestId("inv-approve").click();
    await expect(page.getByTestId("inv-count-status")).toHaveText("דורש טיפול", { timeout: 15_000 });
    const sent = s.lines.find((l) => l.product_id === robot.id)!;
    expect(sent.delta).toBe(-2);          // exactly what the screen showed
    expect(sent.rivhit_doc_type).toBe(10); // stock out
    await expect(table).toContainText("לא נקלטה כמות רווחית בזמן הספירה — ספרו מחדש");
    expect(errors).toEqual([]);
    await context.close();
  });

  test("a stuck item-edit request can be closed with a note", async ({ browser, baseURL }) => {
    const s = newInvState();
    const reqId = seedEditRequest(s, "6928810168960", "unknown");
    const { context, page } = await open(browser, baseURL, s);
    await startCount(page);
    await wedge(page, "6928810168960");
    await page.getByRole("button", { name: "עריכת פריט" }).click();
    const panel = page.getByRole("region", { name: "עריכת פריט" });
    await expect(panel.getByRole("status").filter({ hasText: "מצב הבקשה" })).toContainText("דורש טיפול");
    await panel.getByRole("button", { name: "סגירת הבקשה" }).click();
    const box = panel.getByRole("group", { name: "סגירת בקשת העריכה" });
    await expect(box).toContainText("אם הסטטוס היה 'דורש בדיקה' — ייתכן שהשינוי כבר קיים ברווחית; בדקו שם ידנית");
    const ok = box.getByRole("button", { name: "אישור סגירת הבקשה" });
    await expect(ok).toBeDisabled();
    await box.getByLabel(/סיבה/).fill("נבדק ברווחית — השם כבר עודכן ידנית");
    await ok.click();
    await expect(panel.getByRole("status").filter({ hasText: "מצב הבקשה" })).toContainText("בוטלה");
    expect(s.edits[0].status).toBe("cancelled");
    expect(callsOf(s, "inv_close_item_edit")[0].args).toEqual({ p_request_id: reqId, p_note: "נבדק ברווחית — השם כבר עודכן ידנית" });
    await context.close();
  });

  test("item edit shows the current price + description and sends only the changed ones (v2)", async ({ browser, baseURL }) => {
    const s = newInvState();
    const p = BY_SKU("6928810168960");
    s.itemDetails = { [p.id]: { price: 12.9, description: "" } };
    const { context, page, errors } = await open(browser, baseURL, s);
    await startCount(page);
    await wedge(page, "6928810168960");
    await page.getByRole("button", { name: "עריכת פריט" }).click();
    const panel = page.getByRole("region", { name: "עריכת פריט" });
    const price = panel.getByLabel(/מחיר בסיס/);
    await expect(price).toHaveValue("12.90");
    await expect(panel.getByLabel(/תיאור פריט/)).toHaveValue("");
    await price.fill("14,50");
    await panel.getByLabel(/תיאור פריט/).fill("  מסוק שלט 3 ערוצים  ");
    const table = panel.getByRole("table", { name: "לפני ואחרי" });
    await expect(table).toContainText("₪12.90");
    await expect(table).toContainText("₪14.50");
    await expect(table).toContainText("מסוק שלט 3 ערוצים");
    await panel.getByRole("button", { name: "שליחת השינוי לרווחית" }).click();
    await expect(panel.getByRole("status").filter({ hasText: "מצב הבקשה" })).toContainText("הושלם");
    expect(callsOf(s, "inv_request_item_edit_v2")[0].args).toEqual({
      p_product_id: p.id, p_new_name: null, p_new_barcode: null, p_new_sku: null, p_new_price: 14.5, p_new_description: "מסוק שלט 3 ערוצים",
    });
    expect(callsOf(s, "inv_request_item_edit")).toHaveLength(0);
    expect(errors).toEqual([]);
    await context.close();
  });

  test("before the v2 migration the item edit works as before (no price/description fields)", async ({ browser, baseURL }) => {
    const s = newInvState();
    const { context, page } = await open(browser, baseURL, s);
    await startCount(page);
    await wedge(page, "6928810168960");
    await page.getByRole("button", { name: "עריכת פריט" }).click();
    const panel = page.getByRole("region", { name: "עריכת פריט" });
    await expect(panel.getByLabel(/^שם/)).toBeVisible();
    await expect(panel.getByLabel(/מחיר בסיס/)).toHaveCount(0);
    await panel.getByLabel(/^שם/).fill("שם חדש לבדיקה");
    await panel.getByRole("button", { name: "שליחת השינוי לרווחית" }).click();
    await expect(panel.getByRole("status").filter({ hasText: "מצב הבקשה" })).toContainText("הושלם");
    expect(callsOf(s, "inv_request_item_edit")).toHaveLength(1);
    await context.close();
  });

  test("photo: upload a new photo (replaces Rivhit's), then remove it", async ({ browser, baseURL }) => {
    const s = newInvState();
    const p = BY_SKU("6928810168960");
    s.itemDetails = { [p.id]: { price: 12.9, description: "" } };
    s.photos = { [p.id]: { url: null, replace_rivhit: false, rivhit: "https://api.rivhit.co.il/online/FileService.svc/getItemPic/r/1.jpg" } };
    const { context, page, errors } = await open(browser, baseURL, s);
    await startCount(page);
    await wedge(page, "6928810168960");
    await page.getByRole("button", { name: "עריכת פריט" }).click();
    const box = page.getByRole("region", { name: "תמונת המוצר" });
    await expect(box.getByTestId("photo-source")).toHaveText("מוצג עכשיו: תמונה מרווחית");
    await expect(box.getByRole("button", { name: "שמירת התמונה" })).toBeDisabled();
    // a real 8x8 PNG
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP438CAFWEXHbQSAKmzX8FBxi1QAAAAAElFTkSuQmCC", "base64");
    await box.getByLabel(/בחירת תמונה/).setInputFiles({ name: "x.png", mimeType: "image/png", buffer: png });
    await expect(box.getByTestId("photo-source")).toHaveText("תצוגה מקדימה — עוד לא נשמרה");
    await box.getByRole("button", { name: "שמירת התמונה" }).click();
    await expect(box.getByRole("status")).toContainText("התמונה נשמרה ומופיעה עכשיו באתר");
    expect(s.uploads).toHaveLength(1);
    expect(s.uploads![0]).toMatch(new RegExp(`^${p.id}/[0-9]{13}\\.jpg$`));
    const set = callsOf(s, "inv_set_product_photo")[0].args;
    expect(set.p_replace).toBe(true);
    expect(String(set.p_url)).toContain(`/storage/v1/object/public/product-photos/${s.uploads![0]}`);
    await expect(box.getByTestId("photo-source")).toHaveText("מוצג עכשיו: תמונה שהועלתה באתר");

    await box.getByRole("button", { name: "הסרת התמונה שהועלתה" }).click();
    await expect(box.getByRole("status")).toContainText("מוצגת שוב התמונה מרווחית");
    await expect(box.getByTestId("photo-source")).toHaveText("מוצג עכשיו: תמונה מרווחית");
    expect(errors).toEqual([]);
    await context.close();
  });

  test("photo: 'only if Rivhit has none' keeps showing Rivhit's photo and says so", async ({ browser, baseURL }) => {
    const s = newInvState();
    const p = BY_SKU("6928810168960");
    s.photos = { [p.id]: { url: null, replace_rivhit: false, rivhit: "https://api.rivhit.co.il/online/FileService.svc/getItemPic/r/1.jpg" } };
    const { context, page } = await open(browser, baseURL, s);
    await startCount(page);
    await wedge(page, "6928810168960");
    await page.getByRole("button", { name: "עריכת פריט" }).click();
    const box = page.getByRole("region", { name: "תמונת המוצר" });
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP438CAFWEXHbQSAKmzX8FBxi1QAAAAAElFTkSuQmCC", "base64");
    await box.getByLabel(/בחירת תמונה/).setInputFiles({ name: "x.png", mimeType: "image/png", buffer: png });
    await box.getByLabel("רק אם אין תמונה ברווחית").check();
    await box.getByRole("button", { name: "שמירת התמונה" }).click();
    await expect(box.getByRole("status")).toContainText("כרגע מוצגת התמונה מרווחית");
    expect(callsOf(s, "inv_set_product_photo")[0].args.p_replace).toBe(false);
    await context.close();
  });

  test("a failed line can be skipped with a note → the count is done (with skipped items)", async ({ browser, baseURL }) => {
    const s = newInvState();
    const id = seedDraftCount(s, [["6928810168960", 42], ["6924050751115", 50]]);
    const heli = BY_SKU("6924050751115");
    s.failOnSync.add(heli.id);
    const { context, page, errors } = await open(browser, baseURL, s);
    await page.goto(`admin/inventory/?count=${id}&view=review`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("inv-approve").click();
    await expect(page.getByTestId("inv-count-status")).toHaveText("דורש טיפול", { timeout: 15_000 });
    const table = page.getByTestId("inv-review-table");
    await expect(table).toContainText("פריט לא קיים ברווחית");

    await table.getByRole("button", { name: "דלג על הפריט" }).click();
    const box = page.getByRole("group", { name: `דילוג על ${heli.name}` });
    await expect(box).toContainText("הפריט לא יעודכן בספירה הזו. אם הסטטוס היה 'דורש בדיקה' — ייתכן שתעודה כבר נוצרה ברווחית; בדקו ברווחית ידנית");
    const confirm = box.getByRole("button", { name: "אישור הדילוג" });
    await expect(confirm).toBeDisabled();
    await box.getByLabel(/סיבה/).fill("אין");
    await expect(confirm).toBeEnabled();
    await box.getByLabel(/סיבה/).fill("הפריט לא קיים ברווחית — ייפתח מחדש");
    await confirm.click();
    await expect(page.getByTestId("inv-count-status")).toHaveText("הושלם (עם פריטים שדולגו)");
    await expect(table).toContainText("דולג");
    expect(callsOf(s, "inv_resolve_line")[0].args).toMatchObject({ p_line_id: s.lines[1].id, p_note: "הפריט לא קיים ברווחית — ייפתח מחדש" });
    expect(s.counts[0].status).toBe("done");

    await page.getByRole("button", { name: "היסטוריה" }).click();
    const hist = page.getByRole("list", { name: "היסטוריית הספירה" });
    await expect(hist).toContainText("פריט דולג (החלטת מנהל)");
    await expect(hist).toContainText("העדכון נדחה ברווחית (סימולציה)");
    expect(errors).toEqual([]);
    await context.close();
  });

  test("approve with a stale version: refused, reloaded, explained; the second approve works", async ({ browser, baseURL }) => {
    const s = newInvState();
    const id = seedDraftCount(s, [["6928810168960", 42]]);
    const { context, page } = await open(browser, baseURL, s);
    await page.goto(`admin/inventory/?count=${id}&view=review`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("inv-review-table").locator("tbody tr")).toHaveCount(1);
    // Another manager saves a line meanwhile → the count version moves on.
    const p = BY_SKU("6924050751115");
    s.lines.push({ ...s.lines[0], id: "3333dddd-0000-4000-8000-999999999999", product_id: p.id, product_name: p.name, counted_qty: 9, baseline_qty: 10 });
    s.counts[0].version = 2;
    await page.getByTestId("inv-approve").click();
    await expect(page.getByRole("alert").filter({ hasText: "הרשימה השתנתה" })).toBeVisible();
    expect(callsOf(s, "inv_approve")[0].args.p_expected_version).toBe(1);
    expect(s.counts[0].status).toBe("draft");
    await expect(page.getByTestId("inv-review-table").locator("tbody tr")).toHaveCount(2);
    await page.getByTestId("inv-approve").click();
    await expect(page.getByTestId("inv-count-status")).toHaveText("הושלם", { timeout: 15_000 });
    expect(callsOf(s, "inv_approve")[1].args.p_expected_version).toBe(2);
    await context.close();
  });

  test("a very high quantity needs an explicit yes; a short code after a typed digit is not saved", async ({ browser, baseURL }) => {
    const s = newInvState();
    const { context, page, dialogs } = await open(browser, baseURL, s);
    await startCount(page);
    await wedge(page, "6928810168960"); // record 40 → limit max(1000, 400)
    await expect(qtyInput(page)).toBeFocused();
    // The reviewer's case: "5", then a 5-digit code burst + Enter.
    await page.keyboard.type("5", { delay: 150 });
    await page.keyboard.type("00777", { delay: 5 });
    await page.keyboard.press("Enter");
    await expect(qtyInput(page)).toHaveValue("5");
    expect(callsOf(s, "inv_save_line")).toHaveLength(0);

    await qtyInput(page).fill("5000");
    dialogs.answer = false;
    await page.getByRole("button", { name: "שמור והמשך" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "לא נשמר" })).toBeVisible();
    expect(dialogs.seen.at(-1)).toContain("הכמות גבוהה מאוד — לאשר?");
    expect(callsOf(s, "inv_save_line")).toHaveLength(0);
    dialogs.answer = true;
    await page.getByRole("button", { name: "שמור והמשך" }).click();
    await expect(page.getByRole("status").filter({ hasText: "נשמר" })).toContainText("5,000");
    expect(s.lines[0].counted_qty).toBe(5000);
    await context.close();
  });

  test("backend not installed: a calm message, no errors", async ({ browser, baseURL }) => {
    const s = newInvState({ backendMissing: true });
    const { context, page } = await open(browser, baseURL, s);
    await page.goto("admin/inventory/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("inv-backend-missing")).toContainText("ספירת המלאי עדיין לא הופעלה בשרת");
    // (Next.js keeps an empty role="alert" route announcer on the page — only alerts with text count.)
    await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "ספירה חדשה" })).toHaveCount(0);
    await page.goto("admin/inventory/?count=2222cccc-0000-4000-8000-000000000001&view=count", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("inv-backend-missing")).toContainText("ספירת המלאי עדיין לא הופעלה בשרת");
    // (Next.js keeps an empty role="alert" route announcer on the page — only alerts with text count.)
    await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(0);
    await context.close();
  });

  test("sync service unreachable: still counts with no storage, says status unknown", async ({ browser, baseURL }) => {
    const s = newInvState({ syncReachable: false });
    const { context, page } = await open(browser, baseURL, s);
    await page.goto("admin/inventory/", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(/מצב העדכון לרווחית לא ידוע/).first()).toBeVisible();
    await expect(page.getByTestId("inv-sim-banner")).toHaveCount(0);
    await page.getByRole("button", { name: "ספירה חדשה" }).click();
    await expect(page.getByTestId("inv-counter")).toHaveText("נספרו 0 פריטים");
    expect(callsOf(s, "inv_open_count")[0].args).toMatchObject({ p_storage_id: null, p_storage_name: null });
    await context.close();
  });

  test("several storages: the warehouse must be chosen", async ({ browser, baseURL }) => {
    const s = newInvState({ storages: [{ storage_id: 1, storage_name: "מחסן ראשי" }, { storage_id: 2, storage_name: "חנות" }] });
    const { context, page } = await open(browser, baseURL, s);
    await page.goto("admin/inventory/", { waitUntil: "domcontentloaded" });
    const btn = page.getByRole("button", { name: "ספירה חדשה" });
    await expect(btn).toBeDisabled();
    await page.getByRole("combobox").selectOption({ label: "חנות" });
    await btn.click();
    await expect(page.getByTestId("inv-counter")).toHaveText("נספרו 0 פריטים");
    expect(callsOf(s, "inv_open_count")[0].args).toMatchObject({ p_storage_id: 2, p_storage_name: "חנות" });
    await context.close();
  });

  test("no camera: a Hebrew message and the scan field keeps working", async ({ browser, baseURL }) => {
    const s = newInvState();
    const { context, page } = await open(browser, baseURL, s);
    await startCount(page);
    await page.getByRole("button", { name: /סריקת ברקוד/ }).click();
    await expect(page.getByRole("alert").filter({ hasText: "סורק ברקודים או חיפוש" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await wedge(page, "6924050751115");
    await expect(card(page)).toContainText("מסוק");
    await context.close();
  });
});
