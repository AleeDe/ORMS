import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";

// A real embedded PostgreSQL instance: no credentials or live project required.
// Foundation permissions/guards are loaded from the repository's migrations.
export async function campaignDatabase({ beforeWorkflow } = {}) {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key,email text unique,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select current_user::text $$;
    grant usage on schema public,auth to anon,authenticated;
    grant execute on function auth.uid(),auth.role() to anon,authenticated;
    create table public.workspaces(id uuid primary key,owner_id uuid not null references auth.users(id) on delete cascade,name text not null,created_at timestamptz default now());
    create table public.workspace_members(workspace_id uuid references public.workspaces(id) on delete cascade,user_id uuid references auth.users(id) on delete cascade,joined_at timestamptz default now(),primary key(workspace_id,user_id));
    create table public.campaigns(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,user_id uuid not null references auth.users(id),name text,created_at timestamptz default now(),unique(workspace_id,id));
    create table public.campaign_access(workspace_id uuid not null,campaign_id uuid references public.campaigns(id) on delete cascade,user_id uuid references auth.users(id) on delete cascade,role text not null check(role in ('manager','member','viewer')),primary key(campaign_id,user_id),foreign key(workspace_id,user_id) references public.workspace_members(workspace_id,user_id) on delete cascade,foreign key(workspace_id,campaign_id) references public.campaigns(workspace_id,id));
    create table public.leads(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,user_id uuid not null references auth.users(id),business_name text,unique(workspace_id,id));
    create table public.decision_makers(id uuid primary key default gen_random_uuid(),workspace_id uuid not null,lead_id uuid references public.leads(id),user_id uuid,name text);
    create table public.campaign_leads(id uuid primary key default gen_random_uuid(),workspace_id uuid not null,user_id uuid not null,campaign_id uuid not null references public.campaigns(id) on delete cascade,lead_id uuid not null references public.leads(id) on delete cascade,status text not null default 'new' check(status in ('new','contacted','following_up','replied','interested_meeting','won','lost','no_fit')),touch_count integer not null default 0,last_contacted_at timestamptz,added_at timestamptz not null default now(),unique(campaign_id,lead_id),foreign key(workspace_id,campaign_id) references public.campaigns(workspace_id,id),foreign key(workspace_id,lead_id) references public.leads(workspace_id,id));
    create table public.activities(id uuid primary key default gen_random_uuid(),workspace_id uuid not null,user_id uuid not null,campaign_id uuid references public.campaigns(id) on delete cascade,lead_id uuid references public.leads(id) on delete cascade,type text not null,content text,channel text,person_id uuid references public.decision_makers(id),actor_id uuid references auth.users(id) on delete set null,actor_name text,occurred_at timestamptz not null default now(),created_at timestamptz not null default now());
    create table public.tasks(id uuid primary key default gen_random_uuid(),workspace_id uuid not null,user_id uuid not null,campaign_id uuid references public.campaigns(id) on delete cascade,lead_id uuid references public.leads(id) on delete cascade,type text default 'call_lead',title text,due_date date,priority text default 'medium',status text default 'pending',assigned_to uuid references auth.users(id) on delete set null,created_by uuid references auth.users(id) on delete set null,completed_by uuid references auth.users(id) on delete set null,completed_at timestamptz,created_at timestamptz not null default now());
    create table public.team_invitations(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,email text not null,token_hash text not null unique,grants jsonb not null,expires_at timestamptz not null default now()+interval '7 days',created_at timestamptz not null default now(),accepted_at timestamptz,accepted_by uuid references auth.users(id),revoked_at timestamptz,delivery_status text default 'not_configured',sent_at timestamptz);
  `);
  const previous = ["20261025000002_campaign_teams.sql", "20261025000003_multiple_workspaces.sql"].map(file => fs.readFileSync(`supabase/migrations/${file}`, "utf8"));
  function definition(name) {
    for (const sql of [...previous].reverse()) {
      const match = sql.match(new RegExp(`create(?: or replace)? function public\\.${name}\\([\\s\\S]*?\\$\\$;`, "i"));
      if (match) return match[0];
    }
    throw Error(`Missing foundation function: ${name}`);
  }
  for (const name of ["orms_current_workspace", "orms_current_owner", "orms_is_owner", "orms_campaign_role", "orms_can_work", "orms_can_read_lead", "orms_valid_assignee", "orms_guard_workspace_row", "orms_guard_campaign_work", "orms_workspaces", "orms_roster", "orms_campaign_workers", "orms_team_data", "orms_create_invitation"]) await db.exec(definition(name));
  for (const table of ["campaigns", "leads", "decision_makers", "campaign_leads", "activities", "tasks"]) {
    await db.exec(`alter table public.${table} alter column workspace_id set default public.orms_current_workspace(); create trigger orms_00_workspace_guard before insert or update on public.${table} for each row execute function public.orms_guard_workspace_row();`);
  }
  for (const table of ["campaign_leads", "activities", "tasks"]) await db.exec(`create trigger orms_guard_work before insert or update on public.${table} for each row execute function public.orms_guard_campaign_work();`);
  for (const table of ["workspaces", "workspace_members", "campaign_access", "campaigns", "leads", "campaign_leads", "activities", "tasks"]) await db.exec(`alter table public.${table} enable row level security; grant all on public.${table} to authenticated;`);
  for (const name of ["workspace_read", "own_membership", "own_campaign_access", "campaign_read", "campaign_owner", "membership_read", "membership_owner", "membership_work", "lead_read", "lead_owner", "activity_read", "activity_insert", "activity_owner", "task_read", "task_insert", "task_update", "task_delete"]) {
    const match = previous[1].match(new RegExp(`create policy ${name}\\b[\\s\\S]*?;`, "i"));
    if (!match) throw Error(`Missing foundation policy: ${name}`);
    await db.exec(match[0]);
  }
  if (beforeWorkflow) await beforeWorkflow(db);
  for (const file of ["20261102000002_campaign_workflow.sql", "20261102000003_campaign_reporting.sql"]) await db.exec(fs.readFileSync(`supabase/migrations/${file}`, "utf8"));
  return db;
}

export async function seedCampaign(db) {
  const f = Object.fromEntries(["owner", "setter", "closer", "secondCloser", "secondSetter", "viewer", "manager", "outsider", "workspace", "otherWorkspace", "campaign", "otherCampaign", "foreignCampaign", "lead", "foreignLead"].map(key => [key, crypto.randomUUID()]));
  await db.transaction(async tx => {
    for (const key of ["owner", "setter", "closer", "secondCloser", "secondSetter", "viewer", "manager", "outsider"]) await tx.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)", [f[key], `${key}-${f[key]}@example.invalid`, { full_name: key }]);
    await tx.query("insert into public.workspaces(id,owner_id,name) values($1,$2,'Campaign workspace'),($3,$4,'Separate workspace')", [f.workspace, f.owner, f.otherWorkspace, f.outsider]);
    for (const key of ["setter", "closer", "secondCloser", "secondSetter", "viewer", "manager"]) await tx.query("insert into public.workspace_members(workspace_id,user_id) values($1,$2)", [f.workspace, f[key]]);
    await tx.query("insert into public.workspace_members(workspace_id,user_id) values($1,$2)", [f.otherWorkspace, f.setter]);
    await tx.query("insert into public.campaigns(id,workspace_id,user_id,name) values($1,$2,$3,'Main campaign'),($4,$2,$3,'Independent campaign'),($5,$6,$7,'Foreign campaign')", [f.campaign, f.workspace, f.owner, f.otherCampaign, f.foreignCampaign, f.otherWorkspace, f.outsider]);
    for (const [key, role, job] of [["setter", "member", "appointment_setter"], ["closer", "member", "closer"], ["secondCloser", "member", "closer"], ["secondSetter", "member", "appointment_setter"], ["viewer", "viewer", "full_cycle"], ["manager", "manager", "full_cycle"]]) await tx.query("insert into public.campaign_access(workspace_id,campaign_id,user_id,role,work_role) values($1,$2,$3,$4,$5)", [f.workspace, f.campaign, f[key], role, job]);
    await tx.query("insert into public.campaign_access(workspace_id,campaign_id,user_id,role,work_role) values($1,$2,$3,'member','closer'),($4,$5,$3,'member','closer')", [f.workspace, f.otherCampaign, f.setter, f.otherWorkspace, f.foreignCampaign]);
    await tx.query("insert into public.leads(id,workspace_id,user_id,business_name) values($1,$2,$3,'Shared business'),($4,$5,$6,'Foreign business')", [f.lead, f.workspace, f.owner, f.foreignLead, f.otherWorkspace, f.outsider]);
    await tx.query("insert into public.campaign_leads(workspace_id,user_id,campaign_id,lead_id) values($1,$2,$3,$4),($1,$2,$5,$4),($6,$7,$8,$9)", [f.workspace, f.owner, f.campaign, f.lead, f.otherCampaign, f.otherWorkspace, f.outsider, f.foreignCampaign, f.foreignLead]);
  });
  return f;
}

export function actor(db, user, workspace, run) {
  return db.transaction(async tx => {
    await tx.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.headers',$2,true)", [user, JSON.stringify({ "x-orms-workspace": workspace })]);
    await tx.exec("set local role authenticated");
    return run(tx);
  });
}
export async function workflowAction(tx, f, action, version = 0, extra = {}) {
  const { rows } = await tx.query("select public.orms_campaign_lead_action($1,$2,$3,$4,$5,$6,$7,$8) as result", [f.campaign, f.lead, action, extra.requestId ?? crypto.randomUUID(), version, extra.appointment ?? null, extra.closer ?? null, extra.note ?? null]);
  return rows[0].result;
}
export async function performance(tx, campaign = null, from = null, to = null) {
  const { rows } = await tx.query("select public.orms_campaign_performance($1,$2,$3,'Asia/Karachi') as result", [campaign, from, to]);
  return rows[0].result;
}
