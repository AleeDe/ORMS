import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { campaignDatabase, seedCampaign, actor, workflowAction, performance } from "./helpers/campaign-database.mjs";

let db;
before(async () => { db = await campaignDatabase(); });
after(async () => { await db?.close(); });

test("setter qualification hands off inside one campaign and credits the actual member", async () => {
  const f = await seedCampaign(db);
  const qualified = await actor(db, f.setter, f.workspace, tx => workflowAction(tx, f, "qualify", 0, { closer: f.closer }));
  assert.equal(qualified.workflow_stage, "qualified"); assert.equal(qualified.qualified_by, f.setter); assert.equal(qualified.assigned_closer_id, f.closer);
  const independent = (await db.query("select workflow_stage,qualified_by from public.campaign_leads where campaign_id=$1 and lead_id=$2", [f.otherCampaign, f.lead])).rows[0];
  assert.deepEqual(independent, { workflow_stage: "prospecting", qualified_by: null });
  const report = await actor(db, f.owner, f.workspace, tx => performance(tx, f.campaign));
  assert.equal(report.totals.qualified, 1); assert.equal(report.totals.qualified_queue, 1);
  assert.equal(report.members.find(row => row.actor_key === f.setter).qualified, 1);
  assert.equal(report.members.find(row => row.actor_key === f.closer).qualified, 0);
});

test("booking auto-qualifies; retries and rescheduling do not inflate booked-lead totals", async () => {
  const f = await seedCampaign(db), requestId = crypto.randomUUID();
  const appointment = new Date(Date.now() + 86_400_000).toISOString();
  const call = () => actor(db, f.setter, f.workspace, tx => workflowAction(tx, f, "book", 0, { requestId, appointment, closer: f.closer }));
  const first = await call(), retry = await call();
  assert.deepEqual(retry, first); assert.equal(first.workflow_stage, "qualified"); assert.equal(new Date(first.appointment_at).toISOString(), appointment);
  assert.equal((await db.query("select count(*)::int as n from public.activities where campaign_id=$1 and type='MEETING_BOOKED'", [f.campaign])).rows[0].n, 1);
  await assert.rejects(actor(db, f.setter, f.workspace, tx => workflowAction(tx, f, "book", 0, { requestId, appointment, note: "different request" })), /already been used/);
  await actor(db, f.setter, f.workspace, tx => workflowAction(tx, f, "book", first.workflow_version, { appointment: new Date(Date.now() + 172_800_000).toISOString() }));
  const report = await actor(db, f.owner, f.workspace, tx => performance(tx, f.campaign));
  assert.equal(report.totals.qualified, 1); assert.equal(report.totals.appointments, 1);
});

test("raw meeting logging also enters the qualified queue without a status-confirmation click", async () => {
  const f = await seedCampaign(db);
  await actor(db, f.setter, f.workspace, tx => tx.query("insert into public.activities(user_id,campaign_id,lead_id,type,appointment_at) values($1,$2,$3,'MEETING_BOOKED',now()+interval '1 day')", [f.setter, f.campaign, f.lead]));
  const row = (await db.query("select workflow_stage,qualified_by,appointment_at from public.campaign_leads where campaign_id=$1", [f.campaign])).rows[0];
  assert.equal(row.workflow_stage, "qualified"); assert.equal(row.qualified_by, f.setter); assert(row.appointment_at);
});

test("roles, readonly access, scope and protected attribution cannot be bypassed", async () => {
  const f = await seedCampaign(db);
  await assert.rejects(actor(db, f.closer, f.workspace, tx => workflowAction(tx, f, "qualify")), /appointment setter/);
  await assert.rejects(actor(db, f.viewer, f.workspace, tx => workflowAction(tx, f, "qualify")), /working access/);
  await assert.rejects(actor(db, f.outsider, f.otherWorkspace, tx => workflowAction(tx, f, "qualify")), /working access/);
  await assert.rejects(actor(db, f.setter, f.workspace, tx => workflowAction(tx, f, "qualify", 0, { closer: f.outsider })), /closer assigned/);
  await assert.rejects(actor(db, f.setter, f.workspace, tx => tx.query("update public.campaign_leads set qualified_by=$1,workflow_stage='qualified' where campaign_id=$2", [f.owner, f.campaign])), /permission denied/);
  await assert.rejects(actor(db, f.owner, f.workspace, tx => tx.exec("delete from public.campaign_work_events")), /permission denied/);
  const qualified = await actor(db, f.setter, f.workspace, tx => workflowAction(tx, f, "qualify"));
  await assert.rejects(actor(db, f.setter, f.workspace, tx => workflowAction(tx, f, "won", qualified.workflow_version)), /assigned closer/);
  await assert.rejects(actor(db, f.setter, f.workspace, tx => tx.query("update public.campaign_leads set status='won' where campaign_id=$1", [f.campaign])), /closer handles/);
  await assert.rejects(actor(db, f.secondSetter, f.workspace, tx => workflowAction(tx, f, "qualify", qualified.workflow_version, { closer: f.secondCloser })), /qualifier or campaign manager/);
});

test("claiming uses a version check and another closer cannot take or close the lead", async () => {
  const f = await seedCampaign(db);
  const qualified = await actor(db, f.setter, f.workspace, tx => workflowAction(tx, f, "qualify"));
  const claimed = await actor(db, f.closer, f.workspace, tx => workflowAction(tx, f, "claim", qualified.workflow_version));
  await assert.rejects(actor(db, f.secondCloser, f.workspace, tx => workflowAction(tx, f, "claim", qualified.workflow_version)), /changed/);
  await assert.rejects(actor(db, f.secondCloser, f.workspace, tx => workflowAction(tx, f, "claim", claimed.workflow_version)), /another closer/);
  await assert.rejects(actor(db, f.secondCloser, f.workspace, tx => workflowAction(tx, f, "won", claimed.workflow_version)), /assigned closer/);
  const won = await actor(db, f.closer, f.workspace, tx => workflowAction(tx, f, "won", claimed.workflow_version));
  assert.equal(won.workflow_stage, "won"); assert.equal(won.closed_by, f.closer);
  const report = await actor(db, f.owner, f.workspace, tx => performance(tx, f.campaign));
  assert.equal(report.totals.qualified_queue, 0); assert.equal(report.totals.won, 1);
  assert.equal(report.members.find(row => row.actor_key === f.setter).qualified, 1);
  assert.equal(report.members.find(row => row.actor_key === f.closer).won, 1);
});

test("owner and manager assign campaign-specific work roles; removing closing access releases the queue", async () => {
  const f = await seedCampaign(db);
  const qualified = await actor(db, f.setter, f.workspace, tx => workflowAction(tx, f, "qualify", 0, { closer: f.closer }));
  await assert.rejects(actor(db, f.setter, f.workspace, tx => tx.query("select public.orms_set_campaign_work_role($1,$2,'full_cycle')", [f.campaign, f.setter])), /owner or manager/);
  await actor(db, f.manager, f.workspace, tx => tx.query("select public.orms_set_campaign_work_role($1,$2,'appointment_setter')", [f.campaign, f.closer]));
  const row = (await db.query("select assigned_closer_id,workflow_version,qualified_by from public.campaign_leads where id=$1", [qualified.id])).rows[0];
  assert.equal(row.assigned_closer_id, null); assert(row.workflow_version > qualified.workflow_version); assert.equal(row.qualified_by, f.setter);
  const otherRole = await actor(db, f.setter, f.otherWorkspace, tx => tx.query("select public.orms_campaign_work_role($1) as role", [f.foreignCampaign]));
  assert.equal(otherRole.rows[0].role, "closer");
  await assert.rejects(actor(db, f.manager, f.workspace, tx => tx.query("select public.orms_set_campaign_work_role($1,$2,'full_cycle')", [f.otherCampaign, f.setter])), /owner or manager/);
});

test("reports aggregate every outreach row, credit task completers, and restrict managers to their campaign", async () => {
  const f = await seedCampaign(db);
  await actor(db, f.setter, f.workspace, async tx => {
    await tx.query("insert into public.activities(user_id,campaign_id,lead_id,type) select $1,$2,$3,'CALL_CONNECTED' from generate_series(1,1501)", [f.setter, f.campaign, f.lead]);
    await tx.query("insert into public.tasks(user_id,campaign_id,lead_id,title,due_date) values($1,$2,$3,'Follow up',current_date-1)", [f.setter, f.campaign, f.lead]);
  });
  await actor(db, f.owner, f.workspace, tx => tx.query("update public.tasks set status='completed' where campaign_id=$1", [f.campaign]));
  const report = await actor(db, f.owner, f.workspace, tx => performance(tx));
  assert.equal(report.totals.touches, 1501); assert.equal(report.totals.completed_tasks, 1);
  assert.equal(report.members.find(row => row.campaign_id === f.campaign && row.actor_key === f.owner).completed_tasks, 1);
  assert.equal(report.members.find(row => row.campaign_id === f.campaign && row.actor_key === f.setter).touches, 1501);
  const managed = await actor(db, f.manager, f.workspace, tx => performance(tx));
  assert.deepEqual(managed.campaigns.map(row => row.id), [f.campaign]);
  await assert.rejects(actor(db, f.setter, f.workspace, tx => performance(tx, f.campaign)), /owner or manager/);
  await assert.rejects(actor(db, f.owner, f.workspace, tx => performance(tx, f.foreignCampaign)), /owner or manager/);
  const future = await actor(db, f.owner, f.workspace, tx => performance(tx, f.campaign, new Date(Date.now() + 86_400_000).toISOString()));
  assert.equal(future.totals.touches, 0); assert.equal(future.totals.completed_tasks, 0);
});

test("meeting reminders follow handoffs without changing completed task credit", async () => {
  const f = await seedCampaign(db);
  const qualified = await actor(db, f.setter, f.workspace, tx => workflowAction(tx, f, "qualify", 0, { closer: f.closer }));
  const task = await actor(db, f.setter, f.workspace, tx => tx.query("insert into public.tasks(user_id,campaign_id,lead_id,type,title,due_date) values($1,$2,$3,'meeting_reminder','Prepare',current_date) returning id,assigned_to,created_by", [f.setter, f.campaign, f.lead]));
  assert.equal(task.rows[0].assigned_to, f.closer); assert.equal(task.rows[0].created_by, f.setter);
  const handed = await actor(db, f.setter, f.workspace, tx => workflowAction(tx, f, "assign", qualified.workflow_version, { closer: f.secondCloser }));
  assert.equal((await db.query("select assigned_to from public.tasks where id=$1", [task.rows[0].id])).rows[0].assigned_to, f.secondCloser);
  await actor(db, f.secondCloser, f.workspace, tx => tx.query("update public.tasks set status='completed' where id=$1", [task.rows[0].id]));
  await actor(db, f.setter, f.workspace, tx => workflowAction(tx, f, "assign", handed.workflow_version, { closer: f.closer }));
  const done = (await db.query("select assigned_to,completed_by from public.tasks where id=$1", [task.rows[0].id])).rows[0];
  assert.equal(done.completed_by, f.secondCloser); assert.equal(done.assigned_to, f.secondCloser);
});

test("removing access or deleting an account keeps immutable milestone attribution", async () => {
  const f = await seedCampaign(db);
  const qualified = await actor(db, f.setter, f.workspace, tx => workflowAction(tx, f, "qualify", 0, { closer: f.closer }));
  await actor(db, f.closer, f.workspace, tx => workflowAction(tx, f, "won", qualified.workflow_version));
  await db.query("delete from public.campaign_access where campaign_id=$1 and user_id=$2", [f.campaign, f.closer]);
  await db.query("delete from auth.users where id=$1", [f.closer]);
  const report = await actor(db, f.owner, f.workspace, tx => performance(tx, f.campaign));
  const former = report.members.find(row => row.actor_key === f.closer); assert.equal(former.won, 1); assert.equal(former.work_role, "historical"); assert.equal(former.label, "closer");
  assert.equal(report.totals.won, 1);
});

test("empty campaign reports return zero totals and legacy stages do not invent setter credit", async () => {
  const f = { owner: crypto.randomUUID(), workspace: crypto.randomUUID(), campaign: crypto.randomUUID(), lead: crypto.randomUUID() };
  const legacy = await campaignDatabase({ beforeWorkflow: async local => {
    await local.query("insert into auth.users(id,email) values($1,'legacy@example.invalid')", [f.owner]);
    await local.query("insert into public.workspaces(id,owner_id,name) values($1,$2,'Legacy')", [f.workspace, f.owner]);
    await local.query("insert into public.campaigns(id,workspace_id,user_id,name) values($1,$2,$3,'Legacy campaign')", [f.campaign, f.workspace, f.owner]);
    await local.query("insert into public.leads(id,workspace_id,user_id,business_name) values($1,$2,$3,'Legacy lead')", [f.lead, f.workspace, f.owner]);
    await local.query("insert into public.campaign_leads(workspace_id,user_id,campaign_id,lead_id,status) values($1,$2,$3,$4,'interested_meeting')", [f.workspace, f.owner, f.campaign, f.lead]);
  } });
  try {
    const report = await actor(legacy, f.owner, f.workspace, tx => performance(tx, f.campaign));
    assert.equal(report.totals.qualified_queue, 1); assert.equal(report.totals.qualified, 0); assert.equal(report.totals.appointments, 0);
    await legacy.query("delete from public.campaigns where id=$1", [f.campaign]);
    const empty = await actor(legacy, f.owner, f.workspace, tx => performance(tx));
    assert.equal(empty.totals.qualified, 0); assert.deepEqual(empty.campaigns, []); assert.deepEqual(empty.members, []);
  } finally { await legacy.close(); }
});
