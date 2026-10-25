import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

// Compile the real TypeScript modules in memory; no build artifacts or test
// dependencies are needed. The production build checks their types separately.
const requireTs = createRequire(import.meta.url);
requireTs.extensions[".ts"] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filename,
  }).outputText, filename);
};
const { campaignFromSearch, leadHref, scopeCampaign, fetchLeadActivities, channelTouchTotals, missingNextSteps, addLeadsToCampaign } = requireTs("../src/lib/campaign-scope.ts");
const { quickLog } = requireTs("../src/lib/quick-log.ts");
const { CHANNEL_LABELS, channelSupportsAction, defaultPersonId } = requireTs("../src/lib/people.ts");
const { campaignNeighbors, fetchCampaignLeadOrder, leadShortcut } = requireTs("../src/lib/campaign-navigation.ts");
const { canWork, canManage, canChangeTask, safeReturnPath } = requireTs("../src/lib/workspace.ts");

function database({ failTasks = false, failCounts = false } = {}) {
  const rows = {
    campaign_leads: [
      { id: "member-a", lead_id: "shared", campaign_id: "a", status: "new", touch_count: 3, last_contacted_at: null },
      { id: "member-b", lead_id: "shared", campaign_id: "b", status: "replied", touch_count: 11, last_contacted_at: null },
    ], activities: [], tasks: [], decision_makers: [],
  };
  let nextId = 1;
  class Query {
    constructor(table) { this.table = table; this.filters = []; this.orders = []; this.operation = "read"; }
    select() { return this; }
    eq(column, value) { this.filters.push((row) => row[column] === value); return this; }
    is(column, value) { return this.eq(column, value); }
    in(column, values) { this.filters.push((row) => values.includes(row[column])); return this; }
    order(column, options = {}) { this.orders.push({ column, ascending: options.ascending !== false }); return this; }
    range(from, to) { this.page = [from, to + 1]; return this; }
    insert(value) { this.operation = "insert"; this.value = value; return this; }
    upsert(value, options) { assert.equal(options.ignoreDuplicates, true); this.operation = "upsert"; this.value = value; return this; }
    update(value) { this.operation = "update"; this.value = value; return this; }
    single() { this.one = true; return this; }
    then(resolve, reject) { return this.execute().then(resolve, reject); }
    async execute() {
      if ((this.table === "tasks" && failTasks) || (this.operation === "update" && failCounts)) return { data: null, error: new Error("Simulated failure") };
      let result = rows[this.table].filter((row) => this.filters.every((filter) => filter(row)));
      if (this.operation === "insert" || this.operation === "upsert") {
        result = [];
        for (const value of Array.isArray(this.value) ? this.value : [this.value]) {
          if (this.operation === "upsert" && rows[this.table].some((row) => row.campaign_id === value.campaign_id && row.lead_id === value.lead_id)) continue;
          const added = { id: `new-${nextId++}`, occurred_at: new Date().toISOString(), ...value };
          rows[this.table].push(added); result.push(added);
        }
      }
      if (this.operation === "update") result.forEach((row) => Object.assign(row, this.value));
      if (this.orders.length) result.sort((a, b) => {
        for (const { column, ascending } of this.orders) {
          if (a[column] < b[column]) return ascending ? -1 : 1;
          if (a[column] > b[column]) return ascending ? 1 : -1;
        }
        return 0;
      });
      if (this.page) result = result.slice(...this.page);
      if (this.one && result.length !== 1) return { data: null, error: new Error("Expected one row") };
      return { data: structuredClone(this.one ? result[0] : result), error: null };
    }
  }
  return { rows, auth: { getUser: async () => ({ data: { user: { id: "owner" } }, error: null }) }, from: (table) => new Query(table) };
}

test("campaign context survives canonical and existing campaign links", () => {
  assert.equal(campaignFromSearch(new URLSearchParams("campaign=a&from=campaign:b")), "a");
  assert.equal(campaignFromSearch(new URLSearchParams("from=campaign:b")), "b");
  assert.equal(campaignFromSearch(new URLSearchParams()), null);
  assert.equal(leadHref("shared", "a"), "/leads/shared?campaign=a");
});

test("unassigned library reads use IS NULL rather than an unfiltered query", () => {
  const calls = [];
  const query = { eq: (...args) => calls.push(["eq", ...args]), is: (...args) => calls.push(["is", ...args]) };
  scopeCampaign(query, "a"); scopeCampaign(query, null);
  assert.deepEqual(calls, [["eq", "campaign_id", "a"], ["is", "campaign_id", null]]);
});

test("the same lead has separate campaign and library timelines and channel totals", async () => {
  const db = database();
  db.rows.activities = [
    ...Array.from({ length: 1001 }, (_, index) => ({ id: `a-${index}`, lead_id: "shared", campaign_id: "a", type: "EMAIL_SENT", channel: "clinic_email", person_id: null, occurred_at: "2026-10-25T10:00:00Z" })),
    { id: "b", lead_id: "shared", campaign_id: "b", type: "CALL_CONNECTED", channel: "clinic_phone", person_id: null, occurred_at: "2026-10-25T11:00:00Z" },
    { id: "library", lead_id: "shared", campaign_id: null, type: "NOTE_ADDED", channel: null, person_id: null, occurred_at: "2026-10-25T12:00:00Z" },
  ];
  const a = await fetchLeadActivities(db, "shared", "a");
  const b = await fetchLeadActivities(db, "shared", "b");
  const library = await fetchLeadActivities(db, "shared", null);
  assert.equal(a.length, 1001); assert.equal(b.length, 1); assert.equal(library.length, 1);
  assert.equal(channelTouchTotals(a)[0].touches, 1001);
  assert.equal(channelTouchTotals(b)[0].channel, "clinic_phone");
  assert.deepEqual(channelTouchTotals(library), []);
});

test("a pending task in campaign A cannot cover campaign B or the library", () => {
  const outreach = ["a", "b", null].map((campaign_id) => ({ id: "shared", campaign_id, business_name: "Shared lead" }));
  const result = missingNextSteps(outreach, [{ lead_id: "shared", campaign_id: "a" }]);
  assert.deepEqual(result.map((row) => row.campaign_id), ["b", null]);
});

test("adding a shared lead starts fresh without resetting another campaign or an existing membership", async () => {
  const db = database();
  assert.equal(await addLeadsToCampaign(db, "c", ["shared", "shared"]), 1);
  assert.equal(db.rows.campaign_leads.find((row) => row.campaign_id === "c").touch_count, 0);
  assert.equal(await addLeadsToCampaign(db, "b", ["shared"]), 0);
  assert.equal(db.rows.campaign_leads.find((row) => row.campaign_id === "b").touch_count, 11);
  assert.equal(db.rows.campaign_leads.find((row) => row.campaign_id === "b").status, "replied");
});

test("outreach requires a valid campaign membership before any write", async () => {
  const db = database();
  await assert.rejects(quickLog(db, { leadId: "shared", campaignId: null, action: "EMAIL_SENT" }), /Choose a campaign/);
  await assert.rejects(quickLog(db, { leadId: "shared", campaignId: "missing", action: "EMAIL_SENT" }), /not in the selected campaign/);
  assert.equal(db.rows.activities.length, 0); assert.equal(db.rows.tasks.length, 0);
});

test("outreach, follow-up task, touch count and status suggestion belong to the chosen campaign", async () => {
  const db = database();
  const result = await quickLog(db, { leadId: "shared", campaignId: "a", action: "EMAIL_SENT", channel: "clinic_email" });
  assert.equal(db.rows.activities[0].campaign_id, "a"); assert.equal(db.rows.tasks[0].campaign_id, "a");
  assert.equal(db.rows.campaign_leads[0].touch_count, 4); assert.equal(db.rows.campaign_leads[1].touch_count, 11);
  assert.equal(result.statusSuggestion, "contacted"); assert.equal(result.campaignId, "a");
});

test("simultaneous touches do not overwrite one another or update another campaign", async () => {
  const db = database();
  await Promise.all([1, 2].map(() => quickLog(db, { leadId: "shared", campaignId: "a", action: "CALL_CONNECTED" })));
  assert.equal(db.rows.campaign_leads[0].touch_count, 5); assert.equal(db.rows.campaign_leads[1].touch_count, 11);
  assert.equal(db.rows.activities.length, 2);
});

test("a follow-up failure reports the saved activity so a retry does not duplicate outreach", async () => {
  const db = database({ failTasks: true });
  const result = await quickLog(db, { leadId: "shared", campaignId: "a", action: "EMAIL_SENT" });
  assert.equal(result.taskCreated, null); assert.equal(result.warnings.length, 1);
  assert.equal(db.rows.activities.length, 1); assert.equal(db.rows.campaign_leads[0].touch_count, 4);
});

test("counter failures stay visible rather than silently losing campaign progress", async () => {
  const db = database({ failCounts: true });
  const result = await quickLog(db, { leadId: "shared", campaignId: "a", action: "CALL_CONNECTED" });
  assert.match(result.warnings[0], /counter/); assert.equal(db.rows.activities.length, 1);
});

test("business labels preserve the keys used by historical clinic activities", () => {
  assert.equal(CHANNEL_LABELS.clinic_email, "Business email");
  assert.equal(CHANNEL_LABELS.clinic_phone, "Business number");
});

test("a campaign's saved channel overrides a stale per-touch selection", async () => {
  const db = database();
  db.rows.campaign_leads[0].campaigns = { default_channel: "clinic_email" };
  db.rows.campaign_leads[1].campaigns = { default_channel: "clinic_phone" };
  await quickLog(db, { leadId: "shared", campaignId: "a", action: "EMAIL_SENT", channel: "personal_email" });
  await quickLog(db, { leadId: "shared", campaignId: "b", action: "CALL_CONNECTED", channel: "clinic_email" });
  assert.equal(db.rows.activities[0].channel, "clinic_email");
  assert.equal(db.rows.activities[1].channel, "clinic_phone");
});

test("fixed email campaigns reject calls before writing activity or follow-up tasks", async () => {
  const db = database();
  db.rows.campaign_leads[0].campaigns = { default_channel: "clinic_email" };
  await assert.rejects(quickLog(db, { leadId: "shared", campaignId: "a", action: "CALL_ATTEMPTED" }), /not available through Business email/);
  assert.equal(db.rows.activities.length, 0); assert.equal(db.rows.tasks.length, 0);
});

test("per-touch campaigns keep the selected channel and expose matching actions", async () => {
  const db = database();
  db.rows.campaign_leads[0].campaigns = { default_channel: null };
  await quickLog(db, { leadId: "shared", campaignId: "a", action: "EMAIL_SENT", channel: "personal_email" });
  assert.equal(db.rows.activities[0].channel, "personal_email");
  assert.equal(channelSupportsAction("clinic_email", "CALL_CONNECTED"), false);
  assert.equal(channelSupportsAction("clinic_phone", "EMAIL_SENT"), false);
  assert.equal(channelSupportsAction("whatsapp", "CALL_CONNECTED"), true);
  assert.equal(channelSupportsAction(null, "CALL_CONNECTED"), true);
});

test("only an unambiguous linked primary or sole contact is preselected", () => {
  assert.equal(defaultPersonId([]), null);
  assert.equal(defaultPersonId([{ id: "sole", is_primary: false }]), "sole");
  assert.equal(defaultPersonId([{ id: "a", is_primary: false }, { id: "primary", is_primary: true }]), "primary");
  assert.equal(defaultPersonId([{ id: "a", is_primary: false }, { id: "b", is_primary: false }]), null);
  assert.equal(defaultPersonId([{ id: "a", is_primary: true }, { id: "b", is_primary: true }]), null);
});

test("outreach preserves the linked person and refuses a person from another lead", async () => {
  const db = database();
  db.rows.decision_makers = [{ id: "person", lead_id: "shared" }, { id: "unrelated", lead_id: "other" }];
  await quickLog(db, { leadId: "shared", campaignId: "a", action: "CALL_CONNECTED", personId: "person" });
  assert.equal(db.rows.activities[0].person_id, "person");
  await assert.rejects(quickLog(db, { leadId: "shared", campaignId: "a", action: "CALL_CONNECTED", personId: "unrelated" }), /linked to this lead/);
  assert.equal(db.rows.activities.length, 1);
});

test("campaign navigation includes every page, sorts ties consistently and excludes other campaigns", async () => {
  const db = database();
  db.rows.campaign_leads = [
    ...Array.from({ length: 1005 }, (_, i) => ({ id: `member-${String(i).padStart(4, "0")}`, lead_id: `lead-${i}`, campaign_id: "a", added_at: "2026-10-25T00:00:00Z" })).reverse(),
    { id: "other", lead_id: "not-in-campaign", campaign_id: "b", added_at: "2026-10-26T00:00:00Z" },
  ];
  const order = await fetchCampaignLeadOrder(db, "a");
  assert.equal(order.length, 1005);
  assert.equal(order[0].lead_id, "lead-0");
  assert.deepEqual(campaignNeighbors(order, "lead-1000"), { index: 1000, total: 1005, previous: "lead-999", next: "lead-1001" });
  assert.equal(campaignNeighbors(order, "lead-0").previous, null);
  assert.equal(campaignNeighbors(order, "lead-1004").next, null);
  assert.deepEqual(campaignNeighbors(order, "not-in-campaign"), { index: -1, total: 1005, previous: null, next: null });
});

test("lead shortcuts use N/P without taking over modified keys, IME input or key repeats", () => {
  const key = { key: "n", altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, repeat: false, isComposing: false, defaultPrevented: false };
  assert.equal(leadShortcut(key), "next");
  assert.equal(leadShortcut({ ...key, key: "P" }), "previous");
  for (const modifier of ["altKey", "ctrlKey", "metaKey", "shiftKey", "repeat", "isComposing", "defaultPrevented"]) assert.equal(leadShortcut({ ...key, [modifier]: true }), null);
  assert.equal(leadShortcut({ ...key, key: "x" }), null);
});

test("campaign roles separate reading, outreach and task management", () => {
  for (const role of ["owner", "manager", "member"]) assert.equal(canWork(role), true);
  for (const role of [null, undefined, "viewer"]) assert.equal(canWork(role), false);
  assert.equal(canManage("owner"), true); assert.equal(canManage("manager"), true);
  assert.equal(canManage("member"), false); assert.equal(canManage("viewer"), false);
  assert.equal(canChangeTask("member", "me", "me"), true);
  assert.equal(canChangeTask("member", "me", null), true);
  assert.equal(canChangeTask("member", "me", "someone-else"), false);
  assert.equal(canChangeTask("viewer", "me", "me"), false);
  assert.equal(canChangeTask("manager", "me", "someone-else"), true);
});

test("invitation login return paths remain local and preserve password recovery", () => {
  assert.equal(safeReturnPath("/join/abc?source=invite"), "/join/abc?source=invite");
  assert.equal(safeReturnPath("/login/update-password"), "/login/update-password");
  for (const path of [null, "https://evil.invalid", "//evil.invalid", "/\\evil.invalid", "/\nevil.invalid", "javascript:alert(1)"]) assert.equal(safeReturnPath(path), "/");
});
