import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

const requireTs = createRequire(import.meta.url);
requireTs.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: filename,
}).outputText, filename);
const { fetchWorkspaceTasks } = requireTs("../src/lib/tasks.ts");

function database(rows, { cap = 1000, failPage = -1 } = {}) {
  const calls = [];
  class Query {
    filters = []; orders = [];
    select(_fields, options) { this.count = options?.count; return this; }
    eq(column, value) { this.filters.push([column, value]); return this; }
    order(column) { this.orders.push(column); return this; }
    async range(from, to) {
      calls.push({ from, to, filters: this.filters, orders: this.orders });
      if (calls.length === failPage) return { data: null, error: Error("Page unavailable") };
      const selected = rows.filter(row => this.filters.every(([key, value]) => row[key] === value))
        .toSorted((a, b) => { for (const key of this.orders) { const difference = a[key].localeCompare(b[key]); if (difference) return difference; } return 0; });
      return { data: selected.slice(from, Math.min(to + 1, from + cap)), count: this.count ? selected.length : null, error: null };
    }
  }
  return { calls, from(table) { assert.equal(table, "tasks"); return new Query(); } };
}
const row = (id, due_date, rest = {}) => ({ id, workspace_id: "ours", campaign_id: "a", due_date, status: "pending", ...rest });

test("upcoming tasks remain visible after more than 1,000 older/completed tasks", async () => {
  const older = Array.from({ length: 1200 }, (_, i) => row(`old-${String(i).padStart(4, "0")}`, "2026-09-23", { status: i < 800 ? "completed" : "pending" }));
  const future = Array.from({ length: 14 }, (_, i) => row(`future-${String(i).padStart(2, "0")}`, "2026-10-26"));
  const db = database([...future.toReversed(), ...older.toReversed(), row("private", "2026-10-26", { workspace_id: "other" })]);
  const tasks = await fetchWorkspaceTasks(db, "ours");
  assert.equal(tasks.length, 1214);
  assert.equal(tasks.filter(t => t.status === "pending" && t.due_date > "2026-10-25").length, 14);
  assert.equal(new Set(tasks.map(t => t.id)).size, 1214);
  assert.deepEqual(db.calls.map(c => c.from), [0, 1000]);
  assert(db.calls.every(c => c.orders.join(",") === "due_date,id"));
  assert(!tasks.some(t => t.id === "private"));
});

test("campaign filtering and smaller server caps apply on every task page", async () => {
  const expected = Array.from({ length: 37 }, (_, i) => row(`task-${String(i).padStart(2, "0")}`, "2026-10-28"));
  const db = database([...expected, row("other-campaign", "2026-10-29", { campaign_id: "b" })], { cap: 13 });
  const tasks = await fetchWorkspaceTasks(db, "ours", "a");
  assert.deepEqual(tasks.map(t => t.id), expected.map(t => t.id));
  assert.deepEqual(db.calls.map(c => c.from), [0, 13, 26]);
  assert(db.calls.every(c => c.filters.some(([key, value]) => key === "campaign_id" && value === "a")));
});

test("a failed later page reports an error instead of silently showing partial task counts", async () => {
  const db = database(Array.from({ length: 1001 }, (_, i) => row(`task-${i}`, "2026-10-26")), { failPage: 2 });
  await assert.rejects(fetchWorkspaceTasks(db, "ours"), /Page unavailable/);
  assert.deepEqual(await fetchWorkspaceTasks(database([]), "ours"), []);
});
