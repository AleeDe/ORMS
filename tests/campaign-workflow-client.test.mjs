import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
const requireTs = createRequire(import.meta.url);
requireTs.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: filename }).outputText, filename);
const { canSetAppointment, canCloseLead, workflowStatusAllowed, runWorkflowAction, fetchCampaignTeam, fetchAnalyticsActivities, memberPerformanceTotals, performanceCsv } = requireTs("../src/lib/campaign-workflow.ts");

test("work roles respect readonly access and closing ownership", () => {
  const qualified = { workflow_stage: "qualified", assigned_closer_id: "closer" };
  assert(canSetAppointment("member", "appointment_setter")); assert(!canSetAppointment("member", "closer")); assert(!canSetAppointment("viewer", "full_cycle"));
  assert(canCloseLead("member", "closer", qualified, "closer")); assert(!canCloseLead("member", "closer", qualified, "other"));
  assert(!canCloseLead("member", "appointment_setter", qualified, "closer")); assert(canCloseLead("manager", "appointment_setter", qualified, "manager"));
  assert(!canCloseLead("member", "full_cycle", { workflow_stage: "prospecting", assigned_closer_id: null }, "closer"));
  assert(!workflowStatusAllowed("won", "member", "appointment_setter", qualified, "setter"));
  assert(workflowStatusAllowed("no_fit", "member", "appointment_setter", { workflow_stage: "prospecting", assigned_closer_id: null }, "setter"));
  assert(!workflowStatusAllowed("contacted", "member", "closer", { workflow_stage: "won", assigned_closer_id: "closer" }, "closer"));
});

test("workflow retries forward the same request identity, version, actor scope and handoff", async () => {
  const calls = [], intent = { campaign: "campaign-a", lead: "lead-a", action: "assign", version: 3, requestId: "request", closer: "closer", note: "  Qualified by phone  " };
  const db = { rpc: async (name, body) => { calls.push({ name, body }); return { data: {}, error: null }; } };
  await runWorkflowAction(db, intent); await runWorkflowAction(db, intent);
  assert.deepEqual(calls[0], calls[1]); assert.equal(calls[0].body.p_version, 3); assert.equal(calls[0].body.p_campaign, "campaign-a"); assert.equal(calls[0].body.p_note, "Qualified by phone");
  await assert.rejects(runWorkflowAction(db, { ...intent, action: "book", appointment: "invalid" }), /appointment/); assert.equal(calls.length, 2);
  db.rpc = async () => ({ error: Error("Changed by another closer") }); await assert.rejects(runWorkflowAction(db, intent), /another closer/);
});

test("missing migration falls back cleanly while permission failures stay visible", async () => {
  assert.deepEqual(await fetchCampaignTeam({ rpc: async () => ({ error: { code: "PGRST202" } }) }, "a"), { available: false, members: [] });
  await assert.rejects(fetchCampaignTeam({ rpc: async () => ({ error: Error("Access denied") }) }, "a"), /Access denied/);
});

test("member totals keep campaign contributions and escape spreadsheet formulas on export", () => {
  const metrics = { touches: 0, replies: 0, qualified: 0, appointments: 0, won: 0, lost: 0, disqualified: 0, completed_tasks: 0, pending_tasks: 0, overdue_tasks: 0 };
  const members = [{ ...metrics, actor_key: "setter", label: '=HYPERLINK("evil")', work_role: "appointment_setter", campaign_name: "Campaign A", campaign_id: "a", qualified: 2 }, { ...metrics, actor_key: "setter", label: '=HYPERLINK("evil")', work_role: "closer", campaign_name: "Campaign B", campaign_id: "b", won: 1 }];
  const [total] = memberPerformanceTotals(members); assert.equal(total.campaigns, 2); assert.equal(total.qualified, 2); assert.equal(total.won, 1);
  const csv = performanceCsv({ members }); assert(csv.includes('"\'=HYPERLINK(""evil"")"')); assert.equal(csv.split("\r\n").length, 3);
});

test("outreach charts read all pages and honor smaller API caps on every request", async () => {
  const source = Array.from({ length: 1251 }, (_, i) => ({ id: String(i), type: "CALL_CONNECTED", occurred_at: "2026-11-02T00:00:00Z", campaign_id: "a" }));
  const requests = [];
  const db = { from: () => {
    const query = { filters: [], select: () => query, gte: (key, value) => { query.filters.push([key, value]); return query; }, eq: (key, value) => { query.filters.push([key, value]); return query; }, order: () => query,
      range: async (from) => { requests.push(query.filters); return { data: source.slice(from, from + 250), count: from === 0 ? source.length : null, error: null }; } }; return query;
  } };
  const rows = await fetchAnalyticsActivities(db, "2026-11-01", "a"); assert.equal(rows.length, 1251); assert.equal(requests.length, 6);
  for (const filters of requests) assert.deepEqual(filters, [["occurred_at", "2026-11-01"], ["campaign_id", "a"]]);
});
