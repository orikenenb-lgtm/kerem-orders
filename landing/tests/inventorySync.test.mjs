// Unit tests for supabase/functions/inventory-sync/{engine,rivhit}.ts — the
// stock-count → Rivhit sync. Plain node, no deps, same transpile harness as
// rivhitImgProxy.test.mjs. NO network: Rivhit is an in-memory scriptable fake
// and globalThis.fetch is replaced by a tripwire for the whole run.
import { strict as assert } from "node:assert";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "../node_modules/typescript/lib/typescript.js";

const here = dirname(fileURLToPath(import.meta.url));
const fnDir = join(here, "..", "..", "supabase", "functions", "inventory-sync");
const tmp = mkdtempSync(join(tmpdir(), "invsync-"));
for (const name of ["engine", "rivhit"]) {
  const src = readFileSync(join(fnDir, `${name}.ts`), "utf8");
  let js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  js = js.replace(/from ['"]\.\/engine\.ts['"]/g, "from './engine.mjs'");
  writeFileSync(join(tmp, `${name}.mjs`), js);
}
const E = await import(pathToFileURL(join(tmp, "engine.mjs")).href);
const R = await import(pathToFileURL(join(tmp, "rivhit.mjs")).href);
const { syncCount, applyItemEdit, checkCount, captureBaseline, classifyRivhitResponse, buildDocPayload, rollupStatus, byteLength, MAX_PAYLOAD_BYTES } = E;
const { liveRivhit, simulatedRivhit } = R;

// Tripwire: nothing in this suite may touch the network.
let realFetchCalls = 0;
globalThis.fetch = async () => { realFetchCalls++; throw new Error("network forbidden in tests"); };

const tick = () => new Promise((r) => setImmediate(r));
const ALL_DOCS = []; // every Document.New payload any fake saw (global invariant check)

// ---------------------------------------------------------------------------
// In-memory Db
// ---------------------------------------------------------------------------
function makeDb({ count, lines, settings = {}, products = {}, edits = [] }) {
  const st = {
    count: { storage_id: null, mode: null, finished_at: null, ...count },
    lines: new Map(lines.map((l, i) => [l.id, {
      count_id: count.id, product_name: `p${i}`, sync_status: "pending", sync_ref: null, rivhit_before_qty: null,
      delta: null, rivhit_doc_type: null, rivhit_doc_number: null, rivhit_after_qty: null, attempts: 0,
      last_error: null, synced_at: null, version: 1, rivhit_baseline_qty: null, rivhit_baseline_at: null, ...l,
    }])),
    settings: {
      rivhit_writes_enabled: true, rivhit_customer_id: 777, rivhit_last_name: "ספירת מלאי", doc_type_in: 11, doc_type_out: 10,
      ...settings,
    },
    products: new Map(Object.entries(products).map(([k, v]) => [k, { ...v }])),
    edits: new Map(edits.map((e) => [e.id, { status: "pending", attempts: 0, last_error: null, rivhit_before: null, ...e }])),
    hooks: {},
    events: [],
    productWrites: [],
    failProductUpdates: 0,
  };
  const clone = (x) => (x ? JSON.parse(JSON.stringify(x)) : x);
  const db = {
    st,
    async getCount(id) { await tick(); return id === st.count.id ? clone(st.count) : null; },
    async setCountMode(id, mode) {
      await tick();
      if (st.hooks.beforeSetMode) st.hooks.beforeSetMode(st);
      if (id !== st.count.id || st.count.mode != null) return false;
      st.count.mode = mode;
      return true;
    },
    async getLine(id) { await tick(); return clone(st.lines.get(id) ?? null); },
    async setLineBaseline(id, expectedVersion, patch) {
      await tick();
      if (st.hooks.beforeSetBaseline) st.hooks.beforeSetBaseline(st);
      const l = st.lines.get(id);
      if (!l || l.version !== expectedVersion) return false;
      Object.assign(l, patch);
      return true;
    },
    async getProductStock(pid) { await tick(); return st.products.get(pid)?.stock_quantity ?? null; },
    async findDuplicateCode(pid, rid, code) {
      await tick();
      for (const [id, p] of st.products) if (id !== pid && p.is_active !== false && (p.sku === code || p.barcode === code)) return p.name ?? id;
      for (const e of st.edits.values()) {
        if (e.id !== rid && ["pending", "in_progress", "unknown"].includes(e.status) && (e.new_sku === code || e.new_barcode === code)) return e.new_name ?? "open";
      }
      return null;
    },
    async setCountStatus(id, to, from, extra = {}) {
      await tick();
      if (id !== st.count.id || !from.includes(st.count.status)) return false;
      if ("mode" in extra) throw new Error("setCountStatus must not write mode");
      st.count.status = to;
      if ("finished_at" in extra) st.count.finished_at = extra.finished_at;
      return true;
    },
    async getSettings() { await tick(); return clone(st.settings); },
    async listLines(cid) { await tick(); return [...st.lines.values()].filter((l) => l.count_id === cid).map(clone); },
    async claimLine(id, from, expectedRef, patch) {
      await tick();
      const l = st.lines.get(id);
      if (!l || l.sync_status !== from || (l.sync_ref ?? null) !== (expectedRef ?? null)) return null;
      Object.assign(l, patch);
      return clone(l);
    },
    async setLine(id, expected, patch) {
      await tick();
      const l = st.lines.get(id);
      if (!l || l.sync_status !== expected) return false;
      Object.assign(l, patch);
      return true;
    },
    async logEvent(ev) { st.events.push(ev); },
    async updateProductStock(pid, qty) {
      await tick();
      if (st.failProductUpdates > 0) { st.failProductUpdates--; throw new Error("db down"); }
      st.productWrites.push(["stock", pid, qty]);
      st.products.get(pid).stock_quantity = qty;
    },
    async getEdit(id) { await tick(); return clone(st.edits.get(id) ?? null); },
    async claimEdit(id, from, patch) {
      await tick();
      const e = st.edits.get(id);
      if (!e || e.status !== from) return null;
      Object.assign(e, patch);
      return clone(e);
    },
    async setEdit(id, expected, patch) {
      await tick();
      const e = st.edits.get(id);
      if (!e || e.status !== expected) return false;
      Object.assign(e, patch);
      return true;
    },
    async updateProductFields(pid, fields) {
      await tick();
      if (st.failProductUpdates > 0) { st.failProductUpdates--; throw new Error("db down"); }
      st.productWrites.push(["fields", pid, fields]);
      Object.assign(st.products.get(pid), fields);
    },
  };
  return db;
}

// ---------------------------------------------------------------------------
// Scriptable fake Rivhit. queue(method, behaviour...) overrides the next
// call(s); a behaviour is a result object, or {kind, effect:true} meaning
// "Rivhit really did it, but the answer was lost".
// ---------------------------------------------------------------------------
function makeRivhit({ qty = {}, items = [] } = {}) {
  const st = {
    qty: new Map(Object.entries(qty).map(([k, v]) => [Number(k), v])),
    items: new Map(items.map((i) => [i.item_id, { ...i }])),
    refs: new Map(), docs: [], updates: [], calls: [], next: {}, docNo: 500,
    onDoc: null, dropOnUpdate: [],
  };
  const take = (m) => (st.next[m] || []).shift();
  const applyDoc = (p) => {
    for (const it of p.items) {
      const sign = p.document_type === 11 ? 1 : p.document_type === 10 ? -1 : 0;
      st.qty.set(it.item_id, (st.qty.get(it.item_id) ?? 0) + sign * it.quantity);
    }
    st.docNo++;
    st.refs.set(p.request_reference, st.docNo);
    st.docs.push(p);
    ALL_DOCS.push(p);
    return st.docNo;
  };
  const rv = {
    st,
    queue(m, ...b) { (st.next[m] ||= []).push(...b); return rv; },
    async itemQuantity(id, storage) {
      await tick();
      st.calls.push(["itemQuantity", id, storage]);
      const b = take("itemQuantity");
      if (typeof b === "function") return b(st, id);
      if (b) return b;
      if (!st.qty.has(id)) return { kind: "rivhit_error", code: -24, message: "הפריט אינו קיים" };
      return { kind: "ok", data: { quantity: st.qty.get(id) } };
    },
    async documentNew(p) {
      await tick();
      st.calls.push(["documentNew", p.request_reference]);
      if (st.onDoc) st.onDoc(p);
      const b = take("documentNew");
      if (b) {
        if (b.effect) applyDoc(p);
        const res = { ...b };
        delete res.effect;
        return res;
      }
      if (p.prevent_duplicates && st.refs.has(p.request_reference)) {
        return { kind: "already_processed", code: -107, message: "כבר בוצעה בקשה עם אותו מזהה בקשה", data: null };
      }
      if (p.check_only) { st.calls.push(["check_only"]); return { kind: "ok", data: {} }; }
      const n = applyDoc(p);
      return { kind: "ok", data: { document_type: p.document_type, document_number: n } };
    },
    async itemGet(id) {
      await tick();
      st.calls.push(["itemGet", id]);
      const b = take("itemGet");
      if (b) return b;
      const it = st.items.get(id);
      return { kind: "ok", data: it ? { ...it } : null };
    },
    async itemUpdate(p) {
      await tick();
      st.calls.push(["itemUpdate", p.item_id]);
      st.updates.push(p);
      const b = take("itemUpdate");
      if (b && !b.effect) return b;
      const it = st.items.get(p.item_id);
      const map = Object.fromEntries(E.ITEM_UPDATE_FIELDS);
      for (const k of Object.keys(p)) if (map[k] && !st.dropOnUpdate.includes(k)) it[map[k]] = p[k];
      if (b) { const res = { ...b }; delete res.effect; return res; }
      return { kind: "ok", data: { update_success: true } };
    },
    async storageList() {
      st.calls.push(["storageList"]);
      return { kind: "ok", data: st.storages ?? [{ storage_id: 1, storage_name: "ראשי" }] };
    },
  };
  return rv;
}

const docCalls = (rv) => rv.st.calls.filter((c) => c[0] === "documentNew").length;
let idn = 0;
const newId = () => `00000000-0000-4000-8000-${String(++idn).padStart(12, "0")}`;
const COUNT = "c0ffee00-1111-4222-8333-444455556666";

// A standard fixture: products p1..pN with rivhit ids 101.., baseline = qty.
function fixture(spec, { countStatus = "approved", storage_id = null, settings, extraProducts = {} } = {}) {
  const lines = [], products = { ...extraProducts }, qty = {};
  spec.forEach((s, i) => {
    const pid = `prod-${i + 1}`, rid = 101 + i;
    // baseline_qty is the site copy (display only); rivhit_baseline_qty is what the sync compares
    lines.push({ id: `line-${i + 1}`, product_id: pid, rivhit_id: rid, counted_qty: s.counted, baseline_qty: s.siteBaseline ?? s.baseline ?? s.current,
      rivhit_baseline_qty: "rivhitBaseline" in s ? s.rivhitBaseline : (s.baseline ?? s.current), ...(s.line || {}) });
    products[pid] = { stock_quantity: s.baseline ?? s.current };
    qty[rid] = s.current;
  });
  for (const p of Object.values(extraProducts)) if (p.rivhit_id) qty[p.rivhit_id] = p.stock_quantity;
  const db = makeDb({ count: { id: COUNT, status: countStatus, storage_id }, lines, products, settings });
  const rv = makeRivhit({ qty });
  return { db, rv, deps: { db, rivhit: rv, newId } };
}
const line = (db, n) => db.st.lines.get(`line-${n}`);

let n = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);

// ===========================================================================
// sync_count
// ===========================================================================

t("happy path: +delta → type 11, −delta → type 10 with |delta|; lines done, products updated, count done", async () => {
  const { db, rv, deps } = fixture([{ current: 10, counted: 15 }, { current: 10, counted: 3 }], { storage_id: 4 });
  const r = await syncCount(deps, COUNT, { mode: "live" });
  assert.equal(r.ok, true);
  assert.equal(r.count_status, "done");
  assert.equal(rv.st.docs.length, 2);
  const [d1, d2] = rv.st.docs;
  assert.equal(d1.document_type, 11); assert.deepEqual(d1.items, [{ item_id: 101, quantity: 5, storage_id: 4 }]);
  assert.equal(d2.document_type, 10); assert.deepEqual(d2.items, [{ item_id: 102, quantity: 7, storage_id: 4 }]);
  for (const d of rv.st.docs) {
    assert.equal(d.send_mail, false); assert.equal(d.prevent_duplicates, true);
    assert.equal(d.customer_id, 777); assert.equal(d.last_name, "ספירת מלאי");
    assert.match(d.comments, /^ספירת מלאי c0ffee00$/);
    assert.equal(d.check_only, undefined);
  }
  assert.equal(line(db, 1).sync_status, "done"); assert.equal(line(db, 1).rivhit_after_qty, 15);
  assert.equal(line(db, 2).sync_status, "done"); assert.equal(line(db, 2).rivhit_after_qty, 3);
  assert.equal(line(db, 1).rivhit_doc_type, 11); assert.ok(line(db, 1).rivhit_doc_number);
  assert.equal(d1.request_reference, line(db, 1).sync_ref);
  assert.equal(db.st.products.get("prod-1").stock_quantity, 15);
  assert.equal(db.st.products.get("prod-2").stock_quantity, 3);
  assert.ok(db.st.count.finished_at); assert.equal(db.st.count.mode, "live");
  // Item.Quantity is read against the count's storage
  assert.ok(rv.st.calls.filter((c) => c[0] === "itemQuantity").every((c) => c[2] === 4));
});

t("sync_ref, before, delta and doc type are persisted BEFORE Document.New is called", async () => {
  const { db, rv, deps } = fixture([{ current: 2, counted: 9 }]);
  let seen = null;
  rv.st.onDoc = (p) => { seen = { ...line(db, 1), ref: p.request_reference }; };
  await syncCount(deps, COUNT, { mode: "live" });
  assert.equal(seen.sync_status, "in_progress");
  assert.equal(seen.sync_ref, seen.ref);
  assert.equal(seen.rivhit_before_qty, 2); assert.equal(seen.delta, 7); assert.equal(seen.rivhit_doc_type, 11);
  assert.equal(seen.attempts, 1);
});

t("delta 0 → no_change, no document, local stock set to current (live), ref cleared", async () => {
  const { db, rv, deps } = fixture([{ current: 8, counted: 8 }]);
  const r = await syncCount(deps, COUNT, { mode: "live" });
  assert.equal(docCalls(rv), 0);
  assert.equal(line(db, 1).sync_status, "no_change"); assert.equal(line(db, 1).sync_ref, null);
  assert.deepEqual(db.st.productWrites, [["stock", "prod-1", 8]]);
  assert.equal(r.count_status, "done");
});

t("current ≠ baseline → changed, no document, count needs_attention", async () => {
  const { db, rv, deps } = fixture([{ baseline: 10, current: 12, counted: 4 }]);
  const r = await syncCount(deps, COUNT, { mode: "live" });
  assert.equal(docCalls(rv), 0);
  assert.equal(line(db, 1).sync_status, "changed"); assert.equal(line(db, 1).sync_ref, null);
  assert.equal(line(db, 1).rivhit_before_qty, 12);
  assert.match(line(db, 1).last_error, /השתנה/);
  assert.equal(r.count_status, "needs_attention");
  assert.equal(db.st.productWrites.length, 0);
});

t("double run (sequential): the second run sends nothing", async () => {
  const { rv, deps } = fixture([{ current: 1, counted: 5 }, { current: 9, counted: 2 }]);
  await syncCount(deps, COUNT, { mode: "live" });
  const r2 = await syncCount(deps, COUNT, { mode: "live" });
  assert.equal(r2.ok, false); // count is done now → not syncable
  assert.match(r2.error, /INV_BAD_STATUS:done/);
  assert.equal(rv.st.docs.length, 2);
});

t("double approve → two concurrent sync calls: the claim allows exactly one document per line", async () => {
  const spec = Array.from({ length: 6 }, (_, i) => ({ current: 10, counted: i % 2 ? 4 : 13 }));
  const { db, rv, deps } = fixture(spec);
  const [a, b] = await Promise.all([syncCount(deps, COUNT, { mode: "live" }), syncCount(deps, COUNT, { mode: "live" })]);
  assert.equal(rv.st.docs.length, 6);
  const refs = rv.st.docs.map((d) => d.request_reference);
  assert.equal(new Set(refs).size, 6);
  assert.equal(a.processed + b.processed >= 6, true);
  assert.ok(a.lost_claims + b.lost_claims > 0, "the runs really raced");
  for (let i = 1; i <= 6; i++) assert.equal(line(db, i).sync_status, "done");
  assert.equal(db.st.count.status, "done");
});

t("Rivhit error → failed with the Hebrew message, ref cleared, no doc; other lines still go (partial success)", async () => {
  const { db, rv, deps } = fixture([{ current: 5, counted: 6 }, { current: 5, counted: 1 }, { current: 5, counted: 7 }]);
  let k = 0;
  const orig = rv.documentNew;
  rv.documentNew = async (p) => (++k === 2 ? { kind: "rivhit_error", code: -64, message: "כמות הפריטים אינה תקינה" } : orig(p));
  const r = await syncCount(deps, COUNT, { mode: "live" });
  assert.equal(line(db, 1).sync_status, "done");
  assert.equal(line(db, 2).sync_status, "failed"); assert.equal(line(db, 2).sync_ref, null);
  assert.equal(line(db, 2).last_error, "כמות הפריטים אינה תקינה");
  assert.equal(line(db, 3).sync_status, "done");
  assert.equal(rv.st.docs.length, 2);
  assert.equal(r.count_status, "needs_attention");
  assert.equal(db.st.products.get("prod-2").stock_quantity, 5, "failed line never touches the product");
});

t("rate limit mid-run → stop, the rest stay pending; the next call resumes and each line gets ONE document", async () => {
  const { db, rv, deps } = fixture([{ current: 1, counted: 2 }, { current: 1, counted: 3 }, { current: 1, counted: 4 }]);
  rv.queue("documentNew", { kind: "ok", data: { document_number: 900 }, effect: true }, { kind: "rate_limited", message: "HTTP 429" });
  const r = await syncCount(deps, COUNT, { mode: "live" });
  assert.equal(r.stopped, "rate_limited");
  assert.equal(line(db, 1).sync_status, "done");
  assert.equal(line(db, 2).sync_status, "pending"); assert.ok(line(db, 2).sync_ref); assert.equal(line(db, 2).delta, 2);
  assert.equal(line(db, 3).sync_status, "pending"); assert.equal(line(db, 3).attempts, 0);
  assert.equal(r.count_status, "syncing"); assert.equal(r.remaining, 2);
  const ref2 = line(db, 2).sync_ref;
  const r2 = await syncCount(deps, COUNT, { mode: "live" });
  assert.equal(r2.count_status, "done");
  assert.equal(rv.st.docs.length, 3);
  assert.equal(rv.st.docs[1].request_reference, ref2, "resumed line reused its reference");
});

t("rate limit on the quantity read → line released, run stops, nothing sent", async () => {
  const { db, rv, deps } = fixture([{ current: 1, counted: 2 }, { current: 1, counted: 3 }]);
  rv.queue("itemQuantity", { kind: "rate_limited", message: "HTTP 429" });
  const r = await syncCount(deps, COUNT, { mode: "live" });
  assert.equal(r.stopped, "rate_limited"); assert.equal(docCalls(rv), 0);
  assert.equal(line(db, 1).sync_status, "pending"); assert.equal(line(db, 2).sync_status, "pending");
});

t("timeout on Document.New → unknown, run stops; a normal run does NOT resend it", async () => {
  const { db, rv, deps } = fixture([{ current: 10, counted: 4 }, { current: 3, counted: 3 }]);
  rv.queue("documentNew", { kind: "timeout", message: "t", effect: true }); // Rivhit DID make it
  const r = await syncCount(deps, COUNT, { mode: "live" });
  assert.equal(line(db, 1).sync_status, "unknown"); assert.ok(line(db, 1).sync_ref);
  assert.equal(r.stopped, "network");
  assert.equal(line(db, 2).sync_status, "pending");
  const callsBefore = docCalls(rv);
  const r2 = await syncCount(deps, COUNT, { mode: "live" });
  assert.equal(docCalls(rv), callsBefore, "no Document.New on a normal run");
  assert.equal(line(db, 1).sync_status, "unknown");
  assert.equal(line(db, 2).sync_status, "no_change");
  assert.equal(r2.count_status, "needs_attention");
});

t("R1: include_unknown when Rivhit already shows before+delta → NO resend, verify → done", async () => {
  const { db, rv, deps } = fixture([{ current: 10, counted: 4 }]);
  rv.queue("documentNew", { kind: "timeout", message: "t", effect: true });
  await syncCount(deps, COUNT, { mode: "live" });
  const r = await syncCount(deps, COUNT, { mode: "live", includeUnknown: true });
  assert.equal(docCalls(rv), 1, "only the original call");
  assert.equal(rv.st.docs.length, 1);
  assert.equal(line(db, 1).sync_status, "done"); assert.equal(line(db, 1).rivhit_after_qty, 4);
  assert.equal(line(db, 1).attempts, 2);
  assert.equal(r.count_status, "done");
});

t("R1 reviewer probe: unknown line before=10 delta=-2, Rivhit at 8 and NOT remembering the ref → no 2nd document", async () => {
  const L = { id: "L1", count_id: "C", product_id: "P", rivhit_id: 5, product_name: "x", counted_qty: 8, baseline_qty: 10, rivhit_baseline_qty: 10,
    sync_status: "unknown", sync_ref: "ref-1", rivhit_before_qty: 10, delta: -2, rivhit_doc_type: 10, rivhit_doc_number: null,
    rivhit_after_qty: null, attempts: 1, last_error: "timeout", synced_at: new Date(Date.now() - 86400e3).toISOString() };
  const db = makeDb({ count: { id: "C", status: "needs_attention", mode: "live" }, lines: [L], products: { P: { stock_quantity: 10 } } });
  let qty = 8; const docs = [];
  const rivhit = {
    async itemQuantity() { return { kind: "ok", data: { quantity: qty } }; },
    async documentNew(p) { docs.push(p); qty -= p.items[0].quantity; return { kind: "ok", data: { document_number: 99 } }; },
    async storageList() { return { kind: "ok", data: [{ storage_id: 1, storage_name: "x" }] }; },
  };
  const r = await syncCount({ db, rivhit }, "C", { mode: "live", includeUnknown: true });
  assert.equal(docs.length, 0); assert.equal(qty, 8);
  assert.equal(db.st.lines.get("L1").sync_status, "done");
  assert.equal(r.count_status, "done");
});

t("R1: resend (same ref, prevent_duplicates) only when Rivhit still shows before; a -107 there → verify mismatch → unknown, no 2nd doc", async () => {
  const { db, rv, deps } = fixture([{ current: 10, counted: 4 }]);
  rv.queue("documentNew", { kind: "timeout", message: "t" });
  await syncCount(deps, COUNT, { mode: "live" });
  const ref = line(db, 1).sync_ref;
  rv.st.refs.set(ref, 1); // Rivhit claims it processed the ref, yet stock never moved
  await syncCount(deps, COUNT, { mode: "live", includeUnknown: true });
  const docNews = rv.st.calls.filter((c) => c[0] === "documentNew");
  assert.equal(docNews.length, 2); assert.equal(docNews[1][1], ref);
  assert.ok(db.st.events.some((e) => e.kind === "doc_already_processed"));
  assert.equal(rv.st.docs.length, 0);
  assert.equal(line(db, 1).sync_status, "unknown");
});

t("include_unknown when the lost request never reached Rivhit → the resend creates it once → done", async () => {
  const { db, rv, deps } = fixture([{ current: 10, counted: 14 }]);
  rv.queue("documentNew", { kind: "network", message: "reset" });
  await syncCount(deps, COUNT, { mode: "live" });
  await syncCount(deps, COUNT, { mode: "live", includeUnknown: true });
  assert.equal(rv.st.docs.length, 1); assert.equal(line(db, 1).sync_status, "done");
  assert.equal(db.st.products.get("prod-1").stock_quantity, 14);
});

t("include_unknown when stock moved since the lost attempt → stays unknown, nothing sent", async () => {
  const { db, rv, deps } = fixture([{ current: 10, counted: 14 }]);
  rv.queue("documentNew", { kind: "timeout", message: "t" });
  await syncCount(deps, COUNT, { mode: "live" });
  rv.st.qty.set(101, 9); // a sale happened
  await syncCount(deps, COUNT, { mode: "live", includeUnknown: true });
  assert.equal(docCalls(rv), 1);
  assert.equal(line(db, 1).sync_status, "unknown"); assert.match(line(db, 1).last_error, /זז/);
});

t("Rivhit OK but the local product update fails → line stays sent; next run re-verifies with NO new document", async () => {
  const { db, rv, deps } = fixture([{ current: 6, counted: 2 }]);
  db.st.failProductUpdates = 1;
  const r = await syncCount(deps, COUNT, { mode: "live" });
  assert.equal(line(db, 1).sync_status, "sent"); assert.ok(line(db, 1).rivhit_doc_number);
  assert.equal(r.count_status, "syncing");
  const r2 = await syncCount(deps, COUNT, { mode: "live" });
  assert.equal(docCalls(rv), 1);
  assert.equal(line(db, 1).sync_status, "done");
  assert.equal(db.st.products.get("prod-1").stock_quantity, 2);
  assert.equal(r2.count_status, "done");
});

t("unexpected -107 on a fresh line → verify path (no second send)", async () => {
  const { db, rv, deps } = fixture([{ current: 6, counted: 9 }]);
  rv.queue("documentNew", { kind: "already_processed", code: -107, message: "x", effect: true });
  await syncCount(deps, COUNT, { mode: "live" });
  assert.equal(docCalls(rv), 1); assert.equal(line(db, 1).sync_status, "done");
});

t("restart mid-process: a stale in_progress line is recovered as unknown (no doc number) / sent (doc number) — never resent blindly", async () => {
  const old = new Date(Date.now() - 30 * 60_000).toISOString();
  const fresh = new Date(Date.now() - 60_000).toISOString();
  const { db, rv, deps } = fixture([
    // died after persisting the doc intent; Rivhit DID make the document (qty already 14)
    { current: 14, baseline: 10, counted: 14, line: { sync_status: "in_progress", sync_ref: "ref-A", rivhit_before_qty: 10, delta: 4, rivhit_doc_type: 11, attempts: 1, synced_at: old } },
    // died after Document.New returned a number, before verify
    { current: 3, baseline: 5, counted: 3, line: { sync_status: "in_progress", sync_ref: "ref-B", rivhit_before_qty: 5, delta: -2, rivhit_doc_type: 10, rivhit_doc_number: "77", attempts: 1, synced_at: old } },
    // claimed 1 minute ago by a run that may still be alive: hands off
    { current: 5, counted: 8, line: { sync_status: "in_progress", sync_ref: "ref-C", attempts: 1, synced_at: fresh } },
  ]);
  rv.st.refs.set("ref-A", 1); rv.st.refs.set("ref-B", 2);
  const r = await syncCount(deps, COUNT, { mode: "live" });
  assert.equal(r.recovered, 2);
  assert.equal(docCalls(rv), 0, "a normal run sends nothing for recovered lines");
  assert.equal(line(db, 1).sync_status, "unknown");
  assert.equal(line(db, 2).sync_status, "done", "doc number known → verified, done");
  assert.equal(line(db, 3).sync_status, "in_progress");
  await syncCount(deps, COUNT, { mode: "live", includeUnknown: true });
  assert.equal(docCalls(rv), 0, "Rivhit already shows before+delta: verified, never resent (R1)");
  assert.equal(rv.st.docs.length, 0);
  assert.equal(line(db, 1).sync_status, "done");
});

t("verify mismatch after a successful document → unknown with explanation; include_unknown does not resend it", async () => {
  const { db, rv, deps } = fixture([{ current: 10, counted: 12 }]);
  let k = 0;
  const orig = rv.itemQuantity;
  rv.itemQuantity = async (id, s) => (++k === 2 ? { kind: "ok", data: { quantity: 11 } } : orig(id, s));
  const r = await syncCount(deps, COUNT, { mode: "live" });
  assert.equal(line(db, 1).sync_status, "unknown"); assert.match(line(db, 1).last_error, /צפוי 12/);
  assert.equal(r.count_status, "needs_attention");
  await syncCount(deps, COUNT, { mode: "live", includeUnknown: true });
  assert.equal(docCalls(rv), 1, "a line with a doc number is only verified");
  assert.equal(line(db, 1).sync_status, "done");
});

t("time budget exhausted → no new claims, rest pending, resumable", async () => {
  const { db, rv, deps } = fixture([{ current: 1, counted: 2 }, { current: 1, counted: 3 }]);
  const r = await syncCount(deps, COUNT, { mode: "live", deadline: Date.now() - 1 });
  assert.equal(r.stopped, "time_budget"); assert.equal(docCalls(rv), 0);
  assert.equal(line(db, 1).sync_status, "pending");
  const r2 = await syncCount(deps, COUNT, { mode: "live", maxLines: 1 });
  assert.equal(r2.stopped, "max_lines"); assert.equal(rv.st.docs.length, 1); assert.equal(r2.remaining, 1);
});

t("retry_failed gives a failed line a FRESH reference and sends it", async () => {
  const { db, rv, deps } = fixture([{ current: 4, counted: 1 }]);
  rv.queue("documentNew", { kind: "rivhit_error", code: -91, message: "קוד מחסן לא קיים" });
  await syncCount(deps, COUNT, { mode: "live" });
  assert.equal(line(db, 1).sync_status, "failed");
  await syncCount(deps, COUNT, { mode: "live" });
  assert.equal(docCalls(rv), 1, "failed is not retried by default");
  await syncCount(deps, COUNT, { mode: "live", retryFailed: true });
  assert.equal(line(db, 1).sync_status, "done"); assert.equal(rv.st.docs.length, 1);
});

t("uncounted products are never touched", async () => {
  const { db, rv, deps } = fixture([{ current: 1, counted: 2 }], { extraProducts: { "prod-x": { stock_quantity: 50, rivhit_id: 999 } } });
  await syncCount(deps, COUNT, { mode: "live" });
  assert.equal(db.st.products.get("prod-x").stock_quantity, 50);
  assert.ok(db.st.productWrites.every((w) => w[1] !== "prod-x"));
  assert.ok(rv.st.calls.every((c) => c[1] !== 999));
  assert.ok(rv.st.docs.every((d) => d.items.every((i) => i.item_id !== 999)));
});

t("non-integer Rivhit quantity → failed, nothing sent", async () => {
  const { db, rv, deps } = fixture([{ current: 2.5, baseline: 2, counted: 2 }]);
  await syncCount(deps, COUNT, { mode: "live" });
  assert.equal(docCalls(rv), 0); assert.equal(line(db, 1).sync_status, "failed");
});

t("guards: not approved / mode mismatch / live without customer → refused before any call", async () => {
  let f = fixture([{ current: 1, counted: 2 }], { countStatus: "draft" });
  assert.match((await syncCount(f.deps, COUNT, { mode: "live" })).error, /INV_BAD_STATUS:draft/);
  f = fixture([{ current: 1, counted: 2 }]);
  f.db.st.count.mode = "simulation";
  assert.match((await syncCount(f.deps, COUNT, { mode: "live" })).error, /INV_MODE_MISMATCH/);
  f = fixture([{ current: 1, counted: 2 }], { settings: { rivhit_customer_id: null } });
  assert.equal((await syncCount(f.deps, COUNT, { mode: "live" })).error, "INV_NOT_CONFIGURED");
  assert.equal(f.rv.st.calls.length, 0);
  assert.equal((await syncCount(f.deps, "nope", { mode: "live" })).error, "INV_NOT_FOUND");
});

t("simulation mode: zero network, zero product writes, SIM- doc numbers, count marked simulation", async () => {
  const { db } = fixture([{ current: 10, counted: 15 }, { current: 10, counted: 3 }, { current: 4, counted: 4 }, { baseline: 1, current: 2, counted: 0 }]);
  const sim = simulatedRivhit({ quantities: { 101: 10, 102: 10, 103: 4, 104: 2 } });
  const r = await syncCount({ db, rivhit: sim, newId }, COUNT, { mode: "simulation" });
  assert.equal(r.ok, true);
  assert.equal(realFetchCalls, 0);
  assert.equal(db.st.productWrites.length, 0);
  assert.equal(db.st.count.mode, "simulation");
  assert.match(line(db, 1).rivhit_doc_number, /^SIM-11-/);
  assert.match(line(db, 2).rivhit_doc_number, /^SIM-10-/);
  assert.equal(line(db, 1).sync_status, "done"); assert.equal(line(db, 3).sync_status, "no_change");
  assert.equal(line(db, 4).sync_status, "changed");
  assert.equal(r.count_status, "needs_attention");
  for (const d of sim.documents) ALL_DOCS.push(d);
  // works in simulation even when writes are disabled / no customer configured
  const g = fixture([{ current: 1, counted: 3 }], { settings: { rivhit_writes_enabled: false, rivhit_customer_id: null } });
  const r2 = await syncCount({ db: g.db, rivhit: simulatedRivhit({ quantities: { 101: 1 } }), newId }, COUNT, { mode: "simulation" });
  assert.equal(r2.count_status, "done"); assert.equal(g.db.st.productWrites.length, 0);
});

t("check_only preview: Document.New with check_only:true, no line or product changes", async () => {
  const { db, rv, deps } = fixture([{ current: 3, counted: 5 }, { current: 3, counted: 1 }]);
  const before = JSON.stringify([...db.st.lines.values()]);
  rv.st.onDoc = (p) => assert.equal(p.check_only, true);
  const r = await checkCount(deps, COUNT, { mode: "live", maxLines: 1 });
  assert.equal(r.results.length, 1); assert.equal(r.results[0].outcome, "check_ok"); assert.equal(r.results[0].doc_type, 11);
  assert.equal(JSON.stringify([...db.st.lines.values()]), before);
  assert.equal(rv.st.docs.length, 0); assert.equal(db.st.productWrites.length, 0);
});

t("R2: a skipped line is terminal — never read, never sent — and counts as finished in the roll-up", async () => {
  const { db, rv, deps } = fixture([
    { current: 5, counted: 9, line: { sync_status: "skipped", sync_ref: "ref-S", rivhit_before_qty: 5, delta: 4, rivhit_doc_type: 11 } },
    { current: 2, counted: 3 },
  ], { countStatus: "needs_attention" });
  const r = await syncCount(deps, COUNT, { mode: "live", includeUnknown: true, retryFailed: true });
  assert.ok(rv.st.calls.every((c) => c[1] !== 101), "the skipped item is never touched");
  assert.equal(line(db, 1).sync_status, "skipped"); assert.equal(line(db, 1).sync_ref, "ref-S");
  assert.equal(line(db, 2).sync_status, "done");
  assert.equal(r.count_status, "done"); assert.equal(r.remaining, 0);
  assert.equal(rollupStatus([{ sync_status: "skipped" }, { sync_status: "no_change" }]), "done");
  assert.equal(rollupStatus([{ sync_status: "skipped" }, { sync_status: "unknown" }]), "needs_attention");
});

t("R3: the sync compares against rivhit_baseline_qty only; null → changed with the recount message", async () => {
  // site copy says 3, Rivhit's captured baseline says 10 and Rivhit is at 10 → normal document
  const { db, rv, deps } = fixture([
    { current: 10, siteBaseline: 3, rivhitBaseline: 10, counted: 12 },
    { current: 7, siteBaseline: 7, rivhitBaseline: null, counted: 9 },
  ]);
  const r = await syncCount(deps, COUNT, { mode: "live" });
  assert.equal(line(db, 1).sync_status, "done"); assert.equal(rv.st.docs.length, 1);
  assert.equal(line(db, 2).sync_status, "changed");
  assert.equal(line(db, 2).last_error, "לא נקלטה כמות רווחית בזמן הספירה — ספרו מחדש");
  assert.equal(r.count_status, "needs_attention");
});

t("R3 capture_baseline: live reads Item.Quantity (count storage) and writes it conditionally on version", async () => {
  const { db, rv } = fixture([{ current: 13, counted: 1, rivhitBaseline: null }], { countStatus: "draft", storage_id: 3 });
  const deps = { db, rivhit: rv, now: () => new Date("2026-11-24T10:00:00Z") };
  const r = await captureBaseline(deps, "line-1", 1, { mode: "live" });
  assert.deepEqual(r, { ok: true, rivhit_baseline_qty: 13, rivhit_baseline_at: "2026-11-24T10:00:00.000Z" });
  assert.deepEqual(rv.st.calls[0], ["itemQuantity", 101, 3]);
  assert.equal(line(db, 1).rivhit_baseline_qty, 13);
  assert.match((await captureBaseline(deps, "line-1", 2, { mode: "live" })).error, /^INV_CONFLICT/);
  // version bumped by a concurrent save between read and write → lost, nothing written
  line(db, 1).rivhit_baseline_qty = null;
  db.st.hooks.beforeSetBaseline = (st) => { st.lines.get("line-1").version = 2; };
  assert.equal((await captureBaseline(deps, "line-1", 1, { mode: "live" })).error, "INV_CONFLICT");
  assert.equal(line(db, 1).rivhit_baseline_qty, null);
  assert.equal((await captureBaseline(deps, "nope", 1, { mode: "live" })).error, "INV_NOT_FOUND");
});

t("R3 capture_baseline: status rules (draft; needs_attention only for a pending line) and simulation reads products, no Rivhit", async () => {
  let f = fixture([{ current: 4, counted: 1 }], { countStatus: "approved" });
  assert.match((await captureBaseline(f.deps, "line-1", 1, { mode: "live" })).error, /INV_BAD_STATUS:approved/);
  f = fixture([{ current: 4, counted: 1, line: { sync_status: "changed" } }], { countStatus: "needs_attention" });
  assert.match((await captureBaseline(f.deps, "line-1", 1, { mode: "live" })).error, /INV_BAD_STATUS/);
  f = fixture([{ current: 4, counted: 1, line: { sync_status: "pending" } }], { countStatus: "needs_attention" });
  f.db.st.count.mode = "live";
  assert.equal((await captureBaseline(f.deps, "line-1", 1, { mode: "live" })).ok, true);
  assert.match((await captureBaseline(f.deps, "line-1", 1, { mode: "simulation" })).error, /INV_MODE_MISMATCH/);
  f = fixture([{ current: 4, counted: 1, rivhitBaseline: null }], { countStatus: "draft" });
  f.db.st.products.get("prod-1").stock_quantity = 6;
  const r = await captureBaseline(f.deps, "line-1", 1, { mode: "simulation" });
  assert.equal(r.rivhit_baseline_qty, 6); assert.equal(f.rv.st.calls.length, 0);
  assert.equal(f.db.st.productWrites.length, 0);
  f = fixture([{ current: 4, counted: 1, rivhitBaseline: null }], { countStatus: "draft" });
  f.rv.queue("itemQuantity", { kind: "timeout", message: "t" });
  assert.match((await captureBaseline(f.deps, "line-1", 1, { mode: "live" })).error, /INV_RIVHIT_UNAVAILABLE:timeout/);
  assert.equal(f.db.st.count.mode, null, "a failed read locks nothing");
});

t("capture_baseline locks the count's mode: simulation capture → live capture and live sync refused (INV_MODE_MISMATCH), nothing written or sent", async () => {
  const f = fixture([{ current: 4, counted: 9, rivhitBaseline: null }, { current: 2, counted: 5, rivhitBaseline: null }], { countStatus: "draft" });
  assert.equal((await captureBaseline(f.deps, "line-1", 1, { mode: "simulation" })).ok, true);
  assert.equal(f.db.st.count.mode, "simulation");
  const live = await captureBaseline(f.deps, "line-2", 1, { mode: "live" });
  assert.match(live.error, /INV_MODE_MISMATCH:simulation/);
  assert.equal(line(f.db, 2).rivhit_baseline_qty, null, "no baseline written");
  f.db.st.count.status = "approved";
  const r = await syncCount(f.deps, COUNT, { mode: "live" });
  assert.match(r.error, /INV_MODE_MISMATCH:simulation/);
  assert.equal(docCalls(f.rv), 0); assert.equal(f.db.st.count.status, "approved");
  // a lost race on the lock (another request set the other mode first) is refused too
  const g = fixture([{ current: 4, counted: 9, rivhitBaseline: null }], { countStatus: "draft" });
  g.db.st.hooks.beforeSetMode = (st) => { st.count.mode = "simulation"; };
  assert.match((await captureBaseline(g.deps, "line-1", 1, { mode: "live" })).error, /INV_MODE_MISMATCH:simulation/);
  assert.equal(line(g.db, 1).rivhit_baseline_qty, null);
});

t("mode is set only while null (conditional); a lost race to the other mode → INV_MODE_MISMATCH, nothing sent", async () => {
  const { db, rv, deps } = fixture([{ current: 1, counted: 2 }]);
  db.st.hooks.beforeSetMode = (st) => { st.count.mode = "simulation"; };
  const r = await syncCount(deps, COUNT, { mode: "live" });
  assert.match(r.error, /INV_MODE_MISMATCH:simulation/);
  assert.equal(docCalls(rv), 0); assert.equal(db.st.count.status, "approved");
  const g = fixture([{ current: 1, counted: 2 }]);
  await syncCount(g.deps, COUNT, { mode: "live" });
  assert.equal(g.db.st.count.mode, "live");
});

t("live sync with no storage on the count while Rivhit has >1 storages → INV_STORAGE_REQUIRED, nothing sent", async () => {
  const { db, rv, deps } = fixture([{ current: 1, counted: 2 }]);
  rv.st.storages = [{ storage_id: 1, storage_name: "א" }, { storage_id: 2, storage_name: "ב" }];
  const r = await syncCount(deps, COUNT, { mode: "live" });
  assert.equal(r.error, "INV_STORAGE_REQUIRED");
  assert.deepEqual(rv.st.calls, [["storageList"]]);
  assert.equal(db.st.count.status, "approved"); assert.equal(db.st.count.mode, null);
  assert.equal((await checkCount(deps, COUNT, { mode: "live" })).error, "INV_STORAGE_REQUIRED");
  // a count with a storage is fine; so is a single-storage account
  const g = fixture([{ current: 1, counted: 2 }], { storage_id: 2 });
  g.rv.st.storages = rv.st.storages;
  assert.equal((await syncCount(g.deps, COUNT, { mode: "live" })).count_status, "done");
  assert.ok(g.rv.st.calls.every((c) => c[0] !== "storageList"));
});

t("check_only runs on a DRAFT count before approval and writes nothing but an event", async () => {
  const f = fixture([{ current: 3, counted: 4 }, { current: 5, counted: 2 }], { countStatus: "draft" });
  const linesBefore = JSON.stringify([...f.db.st.lines.values()]);
  const countBefore = JSON.stringify(f.db.st.count);
  const productsBefore = JSON.stringify([...f.db.st.products.entries()]);
  const r = await checkCount(f.deps, COUNT, { mode: "live", maxLines: 5 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.results.map((x) => [x.outcome, x.doc_type, x.delta]), [["check_ok", 11, 1], ["check_ok", 10, -3]]);
  assert.equal(JSON.stringify([...f.db.st.lines.values()]), linesBefore);
  assert.equal(JSON.stringify(f.db.st.count), countBefore, "status, mode, version untouched");
  assert.equal(JSON.stringify([...f.db.st.products.entries()]), productsBefore);
  assert.equal(f.db.st.productWrites.length, 0); assert.equal(f.rv.st.docs.length, 0);
  assert.ok(f.rv.st.calls.filter((c) => c[0] === "documentNew").length === 2);
  assert.deepEqual(f.db.st.events.map((e) => e.kind), ["check_only"]);
});

t("checkCount validates status and mode", async () => {
  let f = fixture([{ current: 1, counted: 2 }], { countStatus: "cancelled" });
  assert.match((await checkCount(f.deps, COUNT, { mode: "live" })).error, /INV_BAD_STATUS:cancelled/);
  f = fixture([{ current: 1, counted: 2 }], { countStatus: "done" });
  assert.match((await checkCount(f.deps, COUNT, { mode: "live" })).error, /INV_BAD_STATUS:done/);
  f = fixture([{ current: 1, counted: 2 }]);
  f.db.st.count.mode = "simulation";
  assert.match((await checkCount(f.deps, COUNT, { mode: "live" })).error, /INV_MODE_MISMATCH/);
  assert.equal(f.rv.st.calls.length, 0);
});

// ===========================================================================
// apply_item_edit
// ===========================================================================
const ITEM = {
  item_id: 101, item_name: "כוס חד פעמי", item_part_num: "7290000000017", barcode: "", item_extended_description: "תיאור",
  item_group_id: 3, storage_id: 1, quantity: 40, cost_nis: 2.5, sale_nis: 4.9, currency_id: 1, cost_mtc: 0, sale_mtc: 0,
  exempt_vat: false, location: "A3", sapak: 12, item_name_en: "Cup", picture_link: "x", avitem: 0,
};
function editFixture(edit, { items = [ITEM] } = {}) {
  const db = makeDb({
    count: { id: COUNT, status: "draft" }, lines: [],
    products: { "prod-1": { name: ITEM.item_name, sku: ITEM.item_part_num, barcode: "", stock_quantity: 40 } },
    edits: [{ id: "edit-1", product_id: "prod-1", rivhit_id: 101, old_name: ITEM.item_name, old_barcode: "", old_sku: ITEM.item_part_num,
      // new_* hold the FINAL values: untouched fields are copies of old_*
      new_name: ITEM.item_name, new_barcode: "", new_sku: ITEM.item_part_num, ...edit }],
  });
  const rv = makeRivhit({ items });
  return { db, rv, deps: { db, rivhit: rv } };
}

t("apply_item_edit: sends the FULL record with only the intended fields changed, verifies read-back → done, local copy updated", async () => {
  const { db, rv, deps } = editFixture({ new_name: "כוס חד פעמית 200 מל", new_barcode: "7290001112223" });
  const r = await applyItemEdit(deps, "edit-1", { mode: "live" });
  assert.equal(r.status, "done");
  const p = rv.st.updates[0];
  assert.deepEqual(p, {
    item_id: 101, item_name: "כוס חד פעמית 200 מל", item_part_num: "7290000000017", barcode: "7290001112223",
    item_extended_description: "תיאור", item_group_id: 3, storage_id: 1, cost_nis: 2.5, sale_nis: 4.9, currency_id: 1,
    cost_mtc: 0, sale_mtc: 0, exempt_vat: false, item_name_english: "Cup", storage_location: "A3", supplier_id: 12,
    request_reference: "edit-1",
  });
  assert.equal(rv.st.calls.filter((c) => c[0] === "itemGet").length, 2, "read before and read back");
  assert.equal(db.st.edits.get("edit-1").status, "done");
  assert.deepEqual(db.st.productWrites, [["fields", "prod-1", { name: "כוס חד פעמית 200 מל", barcode: "7290001112223", sku: "7290000000017" }]]);
});

t("apply_item_edit: read-back mismatch → unknown, names the field, no local write", async () => {
  const { db, rv, deps } = editFixture({ new_barcode: "123456" });
  rv.st.dropOnUpdate = ["barcode"]; // Rivhit silently ignored it
  const r = await applyItemEdit(deps, "edit-1", { mode: "live" });
  assert.equal(r.status, "unknown"); assert.deepEqual(r.mismatched, ["barcode"]);
  assert.equal(db.st.productWrites.length, 0);
  // retry (unknown is claimable) — Rivhit now takes it
  rv.st.dropOnUpdate = [];
  const r2 = await applyItemEdit(deps, "edit-1", { mode: "live" });
  assert.equal(r2.status, "done"); assert.equal(db.st.edits.get("edit-1").attempts, 2);
});

t("apply_item_edit: timeout on Item.Update → unknown; rate limit → back to pending; Rivhit error → failed", async () => {
  let f = editFixture({ new_name: "שם חדש" });
  f.rv.queue("itemUpdate", { kind: "timeout", message: "t" });
  assert.equal((await applyItemEdit(f.deps, "edit-1", { mode: "live" })).status, "unknown");
  f = editFixture({ new_name: "שם חדש" });
  f.rv.queue("itemUpdate", { kind: "rate_limited", message: "429" });
  assert.equal((await applyItemEdit(f.deps, "edit-1", { mode: "live" })).status, "pending");
  f = editFixture({ new_name: "שם חדש" });
  f.rv.queue("itemUpdate", { kind: "rivhit_error", code: -79, message: "שם הפריט אינו תקין" });
  const r = await applyItemEdit(f.deps, "edit-1", { mode: "live" });
  assert.equal(r.status, "failed"); assert.equal(r.message, "שם הפריט אינו תקין");
  assert.equal(f.db.st.productWrites.length, 0);
});

t("apply_item_edit: changed in Rivhit since the request → failed, no Item.Update; already applied → done without update; double call → conflict", async () => {
  let f = editFixture({ new_name: "חדש" }, { items: [{ ...ITEM, item_name: "מישהו שינה" }] });
  assert.equal((await applyItemEdit(f.deps, "edit-1", { mode: "live" })).status, "failed");
  assert.equal(f.rv.st.updates.length, 0);
  f = editFixture({ new_name: "חדש", status: "unknown" }, { items: [{ ...ITEM, item_name: "חדש" }] });
  assert.equal((await applyItemEdit(f.deps, "edit-1", { mode: "live" })).status, "done");
  assert.equal(f.rv.st.updates.length, 0);
  f = editFixture({ new_name: "חדש" });
  const [a, b] = await Promise.all([applyItemEdit(f.deps, "edit-1", { mode: "live" }), applyItemEdit(f.deps, "edit-1", { mode: "live" })]);
  assert.equal([a, b].filter((x) => x.ok).length, 1);
  assert.equal(f.rv.st.updates.length, 1);
  const again = await applyItemEdit(f.deps, "edit-1", { mode: "live" });
  assert.match(again.error, /INV_BAD_STATUS:done/);
});

t("apply_item_edit: a field the request did not change keeps Rivhit's CURRENT value (stale site copy never reverts Rivhit)", async () => {
  const { rv, deps } = editFixture({ new_barcode: "555" }, { items: [{ ...ITEM, item_name: "שם שעודכן ברווחית" }] });
  const r = await applyItemEdit(deps, "edit-1", { mode: "live" });
  assert.equal(r.status, "done");
  assert.equal(rv.st.updates[0].item_name, "שם שעודכן ברווחית");
  assert.equal(rv.st.updates[0].barcode, "555");
  const noop = editFixture({});
  assert.equal((await applyItemEdit(noop.deps, "edit-1", { mode: "live" })).status, "failed");
  assert.equal(noop.rv.st.updates.length, 0);
});

t("R5: duplicate code re-checked in the DB right before Item.Update (other active product / other open request) → failed, no write", async () => {
  let f = editFixture({ new_barcode: "999" });
  f.db.st.products.set("prod-2", { name: "מוצר אחר", sku: "999", barcode: "", is_active: true });
  let r = await applyItemEdit(f.deps, "edit-1", { mode: "live" });
  assert.equal(r.status, "failed"); assert.equal(r.message, "INV_DUPLICATE_CODE:מוצר אחר");
  assert.equal(f.rv.st.updates.length, 0); assert.equal(f.db.st.productWrites.length, 0);
  f = editFixture({ new_sku: "NEW-7" });
  f.db.st.edits.set("edit-2", { id: "edit-2", product_id: "prod-9", status: "pending", new_name: "בקשה אחרת", new_sku: "NEW-7", new_barcode: "" });
  r = await applyItemEdit(f.deps, "edit-1", { mode: "live" });
  assert.equal(r.status, "failed"); assert.match(r.message, /^INV_DUPLICATE_CODE/);
  assert.equal(f.rv.st.updates.length, 0);
  // an inactive product with that code does not block
  f = editFixture({ new_barcode: "999" });
  f.db.st.products.set("prod-2", { name: "ישן", sku: "999", is_active: false });
  assert.equal((await applyItemEdit(f.deps, "edit-1", { mode: "live" })).status, "done");
});

t("R6: the full pre-update record is stored once; a non-intended field changed on read-back → unknown naming it", async () => {
  const { db, rv, deps } = editFixture({ new_name: "שם חדש" });
  rv.st.onUpdate = null;
  const orig = rv.itemUpdate;
  rv.itemUpdate = async (p) => { const r = await orig(p); rv.st.items.get(101).sale_nis = 0; rv.st.items.get(101).picture_link = null; return r; };
  const r = await applyItemEdit(deps, "edit-1", { mode: "live" });
  assert.equal(r.status, "unknown"); assert.deepEqual(r.mismatched.sort(), ["picture_link", "sale_nis"]);
  const snap = db.st.edits.get("edit-1").rivhit_before;
  assert.deepEqual(snap, ITEM, "the COMPLETE record, before the update");
  assert.equal(db.st.productWrites.length, 0);
});

t("R6: a recheck compares against the stored snapshot, never against current values", async () => {
  // attempt 1: Item.Update times out but Rivhit applied it
  const { db, rv, deps } = editFixture({ new_name: "שם חדש" });
  rv.queue("itemUpdate", { kind: "timeout", message: "t", effect: true });
  assert.equal((await applyItemEdit(deps, "edit-1", { mode: "live" })).status, "unknown");
  assert.equal(db.st.edits.get("edit-1").rivhit_before.item_name, ITEM.item_name);
  // recheck: Rivhit shows the target and everything else as in the snapshot → done, no 2nd update
  assert.equal((await applyItemEdit(deps, "edit-1", { mode: "live" })).status, "done");
  assert.equal(rv.st.updates.length, 1);
  // another request whose recheck finds a non-intended field moved since the snapshot → unknown, no update
  const g = editFixture({ new_name: "שם חדש" });
  g.rv.queue("itemUpdate", { kind: "timeout", message: "t" });
  await applyItemEdit(g.deps, "edit-1", { mode: "live" });
  g.rv.st.items.get(101).cost_nis = 99; // "current" changed; a current-vs-current check would miss this
  const r = await applyItemEdit(g.deps, "edit-1", { mode: "live" });
  assert.equal(r.status, "unknown"); assert.deepEqual(r.mismatched, ["cost_nis"]);
  assert.equal(g.rv.st.updates.length, 1);
});

t("R7: sku edit when item_part_num is empty (site sku came from the barcode) sets item_part_num, keeps the barcode", async () => {
  const item = { ...ITEM, item_part_num: "", barcode: "7290000000017" };
  const { db, rv, deps } = editFixture({ old_sku: "7290000000017", new_sku: "NEW-1", old_barcode: "7290000000017", new_barcode: "7290000000017" }, { items: [item] });
  const r = await applyItemEdit(deps, "edit-1", { mode: "live" });
  assert.equal(r.status, "done");
  assert.equal(rv.st.updates[0].item_part_num, "NEW-1"); assert.equal(rv.st.updates[0].barcode, "7290000000017");
  assert.deepEqual(db.st.productWrites[0][2], { name: ITEM.item_name, barcode: "7290000000017", sku: "NEW-1" });
  // effective-sku conflict: Rivhit's effective sku is neither old nor new → failed, no write
  const g = editFixture({ old_sku: "111", new_sku: "NEW-1" }, { items: [{ ...ITEM, item_part_num: "", barcode: "222" }] });
  assert.equal((await applyItemEdit(g.deps, "edit-1", { mode: "live" })).status, "failed");
  assert.equal(g.rv.st.updates.length, 0);
});

t("cancelled edit requests are terminal (nothing sent) and never count as duplicates", async () => {
  const f = editFixture({ new_name: "שם חדש", status: "cancelled" });
  const r = await applyItemEdit(f.deps, "edit-1", { mode: "live" });
  assert.equal(r.ok, false); assert.equal(r.error, "INV_BAD_STATUS:cancelled");
  assert.equal(f.rv.st.calls.length, 0); assert.equal(f.db.st.edits.get("edit-1").status, "cancelled");
  assert.equal(f.db.st.edits.get("edit-1").attempts, 0);
  // closed requests (cancelled / failed / done) holding the same code do not block
  const g = editFixture({ new_barcode: "4242" });
  for (const [id, st] of [["e-c", "cancelled"], ["e-f", "failed"], ["e-d", "done"]]) {
    g.db.st.edits.set(id, { id, product_id: `prod-${id}`, status: st, new_name: id, new_sku: "4242", new_barcode: "4242" });
  }
  assert.equal(await g.db.findDuplicateCode("prod-1", "edit-1", "4242"), null);
  assert.equal((await applyItemEdit(g.deps, "edit-1", { mode: "live" })).status, "done");
  g.db.st.edits.set("e-p", { id: "e-p", product_id: "prod-p", status: "unknown", new_name: "פתוחה", new_sku: "4242", new_barcode: "" });
  assert.equal(await g.db.findDuplicateCode("prod-1", "edit-1", "4242"), "פתוחה");
});

t("apply_item_edit in simulation: no product writes, no network", async () => {
  const { db } = editFixture({ new_sku: "NEW-1" });
  const sim = simulatedRivhit({ items: [{ ...ITEM }] });
  const r = await applyItemEdit({ db, rivhit: sim }, "edit-1", { mode: "simulation" });
  assert.equal(r.status, "done"); assert.equal(sim.updates[0].item_part_num, "NEW-1");
  assert.equal(db.st.productWrites.length, 0); assert.equal(realFetchCalls, 0);
});

// ===========================================================================
// pure helpers + the live adapter (with a fake fetch)
// ===========================================================================

t("classifyRivhitResponse covers ok / -107 / 429 / debug code / non-JSON", () => {
  assert.equal(classifyRivhitResponse(200, '{"error_code":0,"data":{"quantity":3}}').kind, "ok");
  assert.equal(classifyRivhitResponse(200, '{"error_code":"0,","data":{"quantity":3}}').kind, "ok");
  assert.equal(classifyRivhitResponse(500, '{"error_code":-107,"client_message":"כבר בוצעה","debug_message":"-107 : REQUEST_ALREADY_PROCESSED"}').kind, "already_processed");
  assert.equal(classifyRivhitResponse(500, '{"error_code":500,"debug_message":"-107 : REQUEST_ALREADY_PROCESSED"}').kind, "already_processed");
  assert.equal(classifyRivhitResponse(429, "Too many").kind, "rate_limited");
  const e = classifyRivhitResponse(500, '{"error_code":500,"client_message":"הפריט אינו קיים","debug_message":"-24 : ITEM_NOT_EXISTS"}');
  assert.deepEqual([e.kind, e.code, e.message], ["rivhit_error", -24, "הפריט אינו קיים"]);
  assert.equal(classifyRivhitResponse(502, "<html>bad gateway</html>").kind, "network");
  assert.equal(classifyRivhitResponse(200, "garbage").kind, "network");
  assert.equal(classifyRivhitResponse(400, "<html>Request Error</html>").kind, "rivhit_error");
});

t("buildDocPayload: positive integer quantity only, 64 KB bound, rollup rules", () => {
  const s = { rivhit_customer_id: 1, rivhit_last_name: "ספירת מלאי - שם ארוך מאוד שחורג משלושים תווים", doc_type_in: 11, doc_type_out: 10 };
  assert.throws(() => buildDocPayload({ countId: COUNT, rivhitId: 1, delta: 0, storageId: null, syncRef: "r", settings: s }));
  assert.throws(() => buildDocPayload({ countId: COUNT, rivhitId: 1, delta: 1.5, storageId: null, syncRef: "r", settings: s }));
  const p = buildDocPayload({ countId: COUNT, rivhitId: 1, delta: -10000000, storageId: null, syncRef: "r", settings: s });
  assert.equal(p.items[0].quantity, 10000000); assert.equal(p.document_type, 10);
  assert.equal(p.last_name.length, 30); assert.equal("storage_id" in p.items[0], false);
  assert.ok(byteLength(JSON.stringify(p)) < MAX_PAYLOAD_BYTES);
  assert.equal(rollupStatus([{ sync_status: "done" }, { sync_status: "no_change" }]), "done");
  assert.equal(rollupStatus([{ sync_status: "done" }, { sync_status: "pending" }]), "syncing");
  assert.equal(rollupStatus([{ sync_status: "failed" }, { sync_status: "pending" }]), "needs_attention");
  assert.equal(rollupStatus([{ sync_status: "sent" }]), "syncing");
});

t("liveRivhit: POSTs to the documented URL with api_token, times out → timeout, never echoes the token", async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, body: JSON.parse(init.body) });
    if (url.endsWith("/Item.List")) return new Response(JSON.stringify({ error_code: 0, data: { item_list: [{ item_id: 7, item_name: "a" }, { item_id: 70, item_name: "b" }] } }), { status: 200 });
    if (url.endsWith("/Storage.List")) return new Response(JSON.stringify({ error_code: 0, data: { storage_list: [{ storage_id: 1, storage_name: "ראשי" }] } }), { status: 200 });
    if (url.endsWith("/Document.New")) {
      return new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    }
    throw new TypeError("connection reset by peer token=SECRET-TOKEN");
  };
  const rv = liveRivhit({ token: "SECRET-TOKEN", fetchImpl, timeoutMs: 30, minIntervalMs: 0 });
  const g = await rv.itemGet(70);
  assert.equal(g.data.item_name, "b");
  assert.equal(seen[0].url, "https://api.rivhit.co.il/online/RivhitOnlineAPI.svc/Item.List");
  assert.equal(seen[0].body.api_token, "SECRET-TOKEN");
  assert.deepEqual(seen[0].body.filter_fields, [{ filter_field: "item_id", filter_Value: "70" }]);
  assert.deepEqual((await rv.storageList()).data, [{ storage_id: 1, storage_name: "ראשי" }]);
  const d = await rv.documentNew(buildDocPayload({ countId: COUNT, rivhitId: 7, delta: 2, storageId: null, syncRef: "r1", settings: { rivhit_customer_id: 1, rivhit_last_name: "x", doc_type_in: 11, doc_type_out: 10 } }));
  assert.equal(d.kind, "timeout");
  const q = await rv.itemQuantity(7, 2);
  assert.equal(q.kind, "network");
  assert.ok(!JSON.stringify([d, q]).includes("SECRET"), "token never in a result");
  assert.equal(seen.at(-1).body.storage_id, 2);
  assert.equal(realFetchCalls, 0);
});

t("global invariant: every document any test produced had a positive integer quantity, one item, send_mail:false", () => {
  assert.ok(ALL_DOCS.length >= 20);
  for (const d of ALL_DOCS) {
    assert.equal(d.items.length, 1);
    for (const it of d.items) assert.ok(Number.isInteger(it.quantity) && it.quantity > 0, JSON.stringify(it));
    assert.equal(d.send_mail, false); assert.equal(d.prevent_duplicates, true);
    assert.ok([10, 11].includes(d.document_type));
  }
});

for (const [name, fn] of tests) {
  await fn();
  n++;
  console.log("✓", name);
}
assert.equal(realFetchCalls, 0, "no test touched the network");
console.log(`\n${n} inventory-sync tests passed`);
