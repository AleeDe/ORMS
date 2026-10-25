begin;

-- Existing workspace ids retain their old value so saved links/preferences keep
-- working. New workspace ids are independent of the account that owns them.
alter table public.workspaces add column id uuid;
update public.workspaces set id=owner_id;
alter table public.workspaces alter column id set not null, alter column id set default gen_random_uuid();
alter table public.workspace_members drop constraint workspace_members_owner_id_fkey, drop constraint workspace_members_check;
alter table public.team_invitations drop constraint team_invitations_owner_id_fkey;
alter table public.workspaces drop constraint workspaces_pkey, add primary key(id);
create index workspaces_owner_idx on public.workspaces(owner_id);
alter table public.workspace_members rename column owner_id to workspace_id;
alter table public.workspace_members add foreign key(workspace_id) references public.workspaces(id) on delete cascade;
alter table public.team_invitations rename column owner_id to workspace_id;
alter table public.team_invitations add foreign key(workspace_id) references public.workspaces(id) on delete cascade;
alter table public.team_invitations add column delivery_status text not null default 'link_created'
  check(delivery_status in ('link_created','sent','failed','not_configured')),
  add column sent_at timestamptz;

-- Some accounts have only preferences or calendar connections, with no leads.
do $$ declare t text; begin
  foreach t in array array['datasets','leads','campaigns','activities','tasks','notes','settings','notifications','contact_channels','google_calendar_tokens'] loop
    execute format('insert into public.workspaces(id,owner_id) select distinct user_id,user_id from public.%I where not exists(select 1 from public.workspaces w where w.id=%I.user_id) on conflict(id) do nothing',t,t);
  end loop;
end; $$;

create function public.orms_current_workspace() returns uuid language plpgsql stable security definer set search_path='' as $$
declare selected uuid; raw text;
begin
  if auth.uid() is null then return null; end if;
  raw:=nullif(current_setting('request.headers',true),'')::jsonb->>'x-orms-workspace';
  if raw is null or raw='' then selected:=auth.uid();
  elsif raw ~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then selected:=raw::uuid;
  else return null; end if;
  if exists(select 1 from public.workspaces w where w.id=selected and
    (w.owner_id=auth.uid() or exists(select 1 from public.workspace_members m where m.workspace_id=w.id and m.user_id=auth.uid()))) then return selected; end if;
  return null;
end; $$;
create or replace function public.orms_current_owner() returns uuid language sql stable security definer set search_path='' as $$
  select owner_id from public.workspaces where id=public.orms_current_workspace();
$$;
create function public.orms_is_owner() returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(public.orms_current_owner()=auth.uid(),false);
$$;

-- Disable attribution guards only during the backfill: updating an existing
-- completed task must not change its historical completion actor.
alter table public.activities disable trigger orms_guard_work;
alter table public.tasks disable trigger orms_guard_work;
alter table public.campaign_leads disable trigger orms_guard_work;
alter table public.datasets disable trigger trg_datasets_updated;
alter table public.leads disable trigger trg_leads_updated;
alter table public.campaigns disable trigger trg_campaigns_updated;
alter table public.notes disable trigger trg_notes_updated;
alter table public.settings disable trigger trg_settings_updated;
alter table public.google_calendar_tokens disable trigger trg_gct_updated;
do $$ declare t text; begin
  foreach t in array array['datasets','leads','lead_emails','lead_phones','decision_makers','campaigns','campaign_leads','activities','tasks','notes','settings','notifications','contact_channels','google_calendar_tokens'] loop
    execute format('alter table public.%I add column workspace_id uuid',t);
    execute format('update public.%I set workspace_id=user_id',t);
    execute format('alter table public.%I alter column workspace_id set not null, alter column workspace_id set default public.orms_current_workspace(), add foreign key(workspace_id) references public.workspaces(id) on delete cascade',t);
    execute format('create index on public.%I(workspace_id)',t);
  end loop;
end; $$;
alter table public.activities enable trigger orms_guard_work;
alter table public.tasks enable trigger orms_guard_work;
alter table public.campaign_leads enable trigger orms_guard_work;
alter table public.datasets enable trigger trg_datasets_updated;
alter table public.leads enable trigger trg_leads_updated;
alter table public.campaigns enable trigger trg_campaigns_updated;
alter table public.notes enable trigger trg_notes_updated;
alter table public.settings enable trigger trg_settings_updated;
alter table public.google_calendar_tokens enable trigger trg_gct_updated;
alter table public.settings drop constraint settings_pkey, add primary key(workspace_id);
alter table public.google_calendar_tokens drop constraint google_calendar_tokens_pkey, add primary key(workspace_id,user_id);
alter table public.contact_channels drop constraint contact_channels_user_id_key_key, add unique(workspace_id,key);
alter table public.campaign_access add column workspace_id uuid;
update public.campaign_access a set workspace_id=c.workspace_id from public.campaigns c where c.id=a.campaign_id;
alter table public.campaign_access alter column workspace_id set not null,
  add foreign key(workspace_id,user_id) references public.workspace_members(workspace_id,user_id) on delete cascade;
alter table public.campaign_channels add column workspace_id uuid;
update public.campaign_channels cc set workspace_id=c.workspace_id from public.campaigns c where c.id=cc.campaign_id;
alter table public.campaign_channels alter column workspace_id set not null, alter column workspace_id set default public.orms_current_workspace();

-- The original FKs keep their cascade/set-null behavior. Deferred composite FKs
-- additionally forbid cross-workspace links, including service-role writes.
do $$ declare t text; begin
  foreach t in array array['datasets','leads','decision_makers','campaigns','tasks','contact_channels'] loop
    execute format('alter table public.%I add unique(workspace_id,id)',t);
  end loop;
end; $$;
alter table public.leads add foreign key(workspace_id,dataset_id) references public.datasets(workspace_id,id) deferrable initially deferred;
do $$ declare t text; begin
  foreach t in array array['lead_emails','lead_phones','decision_makers','campaign_leads','activities','tasks','notes','notifications'] loop
    execute format('alter table public.%I add foreign key(workspace_id,lead_id) references public.leads(workspace_id,id) deferrable initially deferred',t);
  end loop;
  foreach t in array array['campaign_leads','activities','tasks','campaign_access','campaign_channels'] loop
    execute format('alter table public.%I add foreign key(workspace_id,campaign_id) references public.campaigns(workspace_id,id) deferrable initially deferred',t);
  end loop;
end; $$;
alter table public.activities add foreign key(workspace_id,person_id) references public.decision_makers(workspace_id,id) deferrable initially deferred;
alter table public.notifications add foreign key(workspace_id,task_id) references public.tasks(workspace_id,id) deferrable initially deferred;
alter table public.campaign_channels add foreign key(workspace_id,channel_id) references public.contact_channels(workspace_id,id) deferrable initially deferred;

create function public.orms_guard_workspace_row() returns trigger language plpgsql security definer set search_path='' as $$
declare ws uuid; owner uuid;
begin
  if tg_op='UPDATE' and new.workspace_id is distinct from old.workspace_id then raise exception 'Records cannot move between workspaces' using errcode='23514'; end if;
  if pg_trigger_depth()>1 then return new; end if;
  ws:=coalesce(new.workspace_id,public.orms_current_workspace());
  if ws is null and auth.uid() is null and exists(select 1 from public.workspaces w where w.id=new.user_id and w.owner_id=new.user_id) then ws:=new.user_id; end if;
  select w.owner_id into owner from public.workspaces w where w.id=ws;
  if owner is null then raise exception 'Choose a valid workspace' using errcode='23514'; end if;
  if auth.uid() is not null and ws is distinct from public.orms_current_workspace() then raise exception 'Workspace access denied' using errcode='42501'; end if;
  new.workspace_id:=ws;
  if tg_table_name<>'google_calendar_tokens' then new.user_id:=owner; end if;
  return new;
end; $$;
do $$ declare t text; begin
  foreach t in array array['datasets','leads','lead_emails','lead_phones','decision_makers','campaigns','campaign_leads','activities','tasks','notes','settings','notifications','contact_channels','google_calendar_tokens'] loop
    execute format('create trigger orms_00_workspace_guard before insert or update on public.%I for each row execute function public.orms_guard_workspace_row()',t);
  end loop;
end; $$;

create or replace function public.orms_campaign_role(p_campaign uuid) returns text language sql stable security definer set search_path='' as $$
  select case when w.owner_id=auth.uid() then 'owner' else a.role end
  from public.campaigns c join public.workspaces w on w.id=c.workspace_id
  left join public.campaign_access a on a.campaign_id=c.id and a.user_id=auth.uid()
  where c.id=p_campaign and c.workspace_id=public.orms_current_workspace();
$$;
create or replace function public.orms_can_read_lead(p_lead uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.leads l where l.id=p_lead and l.workspace_id=public.orms_current_workspace()
    and (public.orms_is_owner() or exists(select 1 from public.campaign_leads cl where cl.lead_id=l.id and public.orms_campaign_role(cl.campaign_id) is not null)));
$$;
create or replace function public.orms_valid_assignee(p_user uuid,p_campaign uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.campaigns c join public.workspaces w on w.id=c.workspace_id where c.id=p_campaign and
    (w.owner_id=p_user or exists(select 1 from public.workspace_members m join public.campaign_access a on a.workspace_id=m.workspace_id and a.user_id=m.user_id
      where m.workspace_id=c.workspace_id and m.user_id=p_user and a.campaign_id=c.id and a.role in ('manager','member'))));
$$;

create function public.orms_create_workspace(p_name text) returns uuid language plpgsql security definer set search_path='' as $$
declare ws uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to continue' using errcode='42501'; end if;
  if p_name is null or length(trim(p_name)) not between 1 and 100 then raise exception 'Enter a workspace name (1–100 characters)'; end if;
  insert into public.workspaces(owner_id,name) values(auth.uid(),trim(p_name)) returning id into ws;
  return ws;
end; $$;
create or replace function public.orms_workspaces() returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Sign in to continue'; end if;
  perform pg_advisory_xact_lock(hashtextextended('orms:account:'||auth.uid()::text,0));
  if not exists(select 1 from public.workspaces w where w.owner_id=auth.uid())
    and not exists(select 1 from public.workspace_members m where m.user_id=auth.uid()) then
    insert into public.workspaces(owner_id) values(auth.uid());
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',w.id,'owner_id',w.owner_id,'name',w.name,'is_owner',w.owner_id=auth.uid(),
    'campaigns',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'role',case when w.owner_id=auth.uid() then 'owner' else a.role end))
      from public.campaigns c left join public.campaign_access a on a.campaign_id=c.id and a.user_id=auth.uid()
      where c.workspace_id=w.id and (w.owner_id=auth.uid() or a.role is not null)),'[]'::jsonb)) order by w.created_at,w.id)
    from public.workspaces w where w.owner_id=auth.uid() or exists(select 1 from public.workspace_members m where m.workspace_id=w.id and m.user_id=auth.uid())),'[]'::jsonb);
end; $$;

create or replace function public.orms_roster() returns table(user_id uuid,label text) language sql stable security definer set search_path='' as $$
  select u.id,coalesce(nullif(u.raw_user_meta_data->>'full_name',''),u.email,'Team member') from auth.users u where
    (u.id=public.orms_current_owner() or exists(select 1 from public.workspace_members m where m.workspace_id=public.orms_current_workspace() and m.user_id=u.id)
      or (public.orms_is_owner() and exists(select 1 from public.tasks t where t.workspace_id=public.orms_current_workspace() and t.completed_by=u.id)))
    and (public.orms_is_owner() or u.id=auth.uid() or exists(select 1 from public.campaigns c left join public.campaign_access a on a.campaign_id=c.id and a.user_id=u.id
      where public.orms_campaign_role(c.id) is not null and (c.user_id=u.id or a.role is not null))) order by 2;
$$;
create or replace function public.orms_team_data() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare ws uuid:=public.orms_current_workspace(); owner uuid:=public.orms_current_owner();
begin
  if not public.orms_is_owner() then raise exception 'Only the workspace owner can manage the team' using errcode='42501'; end if;
  return jsonb_build_object(
    'members',coalesce((select jsonb_agg(jsonb_build_object('user_id',u.id,'email',u.email,'label',coalesce(nullif(u.raw_user_meta_data->>'full_name',''),u.email),
      'open_tasks',(select count(*) from public.tasks t where t.workspace_id=ws and t.assigned_to=u.id and t.status='pending'),
      'completed_tasks',(select count(*) from public.tasks t where t.workspace_id=ws and t.completed_by=u.id and t.status='completed'),
      'overdue_tasks',(select count(*) from public.tasks t where t.workspace_id=ws and t.assigned_to=u.id and t.status='pending' and t.due_date<current_date),
      'touches',(select count(*) from public.activities a where a.workspace_id=ws and a.actor_id=u.id and a.type::text in ('EMAIL_SENT','FOLLOWUP_SENT','CALL_ATTEMPTED','CALL_CONNECTED'))))
      from auth.users u where u.id=owner or exists(select 1 from public.workspace_members m where m.workspace_id=ws and m.user_id=u.id)),'[]'::jsonb),
    'campaigns',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name) order by c.name) from public.campaigns c where c.workspace_id=ws),'[]'::jsonb),
    'access',coalesce((select jsonb_agg(to_jsonb(a)) from public.campaign_access a where a.workspace_id=ws),'[]'::jsonb),
    'invitations',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'email',i.email,'expires_at',i.expires_at,'accepted_at',i.accepted_at,'revoked_at',i.revoked_at,'delivery_status',i.delivery_status,'sent_at',i.sent_at,'grants',i.grants) order by i.created_at desc) from public.team_invitations i where i.workspace_id=ws),'[]'::jsonb));
end; $$;

create or replace function public.orms_create_invitation(p_email text,p_grants jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare ws uuid:=public.orms_current_workspace(); token text; invite public.team_invitations; grant_row jsonb; recipient text:=lower(trim(p_email));
begin
  if not public.orms_is_owner() then raise exception 'Only the workspace owner can invite members' using errcode='42501'; end if;
  if recipient is null or recipient !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(recipient)>254 then raise exception 'Enter a valid email'; end if;
  if exists(select 1 from auth.users where id=auth.uid() and lower(email)=recipient) then raise exception 'You already own this workspace'; end if;
  if jsonb_typeof(p_grants) is distinct from 'array' or jsonb_array_length(p_grants) not between 1 and 100 then raise exception 'Choose at least one campaign'; end if;
  perform pg_advisory_xact_lock(hashtextextended('orms:invite:'||ws::text,0));
  if (select count(*) from public.team_invitations where workspace_id=ws and created_at>now()-interval '1 hour')>=30 then raise exception 'Invitation limit reached. Try again later.'; end if;
  for grant_row in select * from jsonb_array_elements(p_grants) loop
    if grant_row->>'role' not in ('manager','member','viewer') or grant_row->>'role' is null
      or not exists(select 1 from public.campaigns c where c.id=(grant_row->>'campaign_id')::uuid and c.workspace_id=ws) then raise exception 'Invalid campaign access'; end if;
  end loop;
  update public.team_invitations set revoked_at=now() where workspace_id=ws and email=recipient and accepted_at is null and revoked_at is null;
  token:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
  insert into public.team_invitations(workspace_id,email,token_hash,grants) values(ws,recipient,encode(sha256(convert_to(token,'utf8')),'hex'),p_grants) returning * into invite;
  return jsonb_build_object('id',invite.id,'token',token,'expires_at',invite.expires_at,'email',recipient,'workspace_name',(select name from public.workspaces where id=ws));
end; $$;
create function public.orms_invitation_preview(p_token text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare invite public.team_invitations;
begin
  if p_token !~ '^[a-f0-9]{64}$' then return null; end if;
  select * into invite from public.team_invitations where token_hash=encode(sha256(convert_to(p_token,'utf8')),'hex');
  if invite.id is null or invite.revoked_at is not null or invite.expires_at<=now() then return null; end if;
  if invite.accepted_at is not null then
    if invite.accepted_by=auth.uid() and exists(select 1 from public.workspace_members where workspace_id=invite.workspace_id and user_id=auth.uid()) then
      return jsonb_build_object('workspace_id',invite.workspace_id,'workspace_name',(select name from public.workspaces where id=invite.workspace_id),'already_joined',true);
    end if;
    return null;
  end if;
  return jsonb_build_object('workspace_name',(select name from public.workspaces where id=invite.workspace_id),'email',invite.email,
    'campaigns',(select jsonb_agg(jsonb_build_object('name',c.name,'role',g->>'role')) from jsonb_array_elements(invite.grants) g join public.campaigns c on c.id=(g->>'campaign_id')::uuid and c.workspace_id=invite.workspace_id));
end; $$;
create or replace function public.orms_accept_invitation(p_token text) returns uuid language plpgsql security definer set search_path='' as $$
declare invite public.team_invitations; grant_row jsonb; verified_email text;
begin
  if auth.uid() is null then raise exception 'Sign in to accept this invitation'; end if;
  select lower(email) into verified_email from auth.users where id=auth.uid() and email_confirmed_at is not null;
  if verified_email is null then raise exception 'Confirm your email address before accepting'; end if;
  select * into invite from public.team_invitations where token_hash=encode(sha256(convert_to(p_token,'utf8')),'hex') for update;
  if invite.id is null or invite.revoked_at is not null or invite.accepted_at is not null or invite.expires_at<=now() then raise exception 'This invitation has expired, was revoked, or has already been used'; end if;
  if invite.email<>verified_email then raise exception 'Sign in with the email address this invitation was issued to'; end if;
  if exists(select 1 from public.workspaces where id=invite.workspace_id and owner_id=auth.uid()) then raise exception 'You already own this workspace'; end if;
  insert into public.workspace_members(workspace_id,user_id) values(invite.workspace_id,auth.uid()) on conflict do nothing;
  for grant_row in select * from jsonb_array_elements(invite.grants) loop
    if not exists(select 1 from public.campaigns c where c.id=(grant_row->>'campaign_id')::uuid and c.workspace_id=invite.workspace_id) then raise exception 'A campaign in this invitation is no longer available'; end if;
    -- A newer permission change must survive accepting an older invitation.
    insert into public.campaign_access(workspace_id,campaign_id,user_id,role) values(invite.workspace_id,(grant_row->>'campaign_id')::uuid,auth.uid(),grant_row->>'role') on conflict(campaign_id,user_id) do nothing;
  end loop;
  update public.team_invitations set accepted_at=now(),accepted_by=auth.uid() where id=invite.id;
  return invite.workspace_id;
end; $$;
create or replace function public.orms_set_campaign_access(p_user uuid,p_campaign uuid,p_role text) returns void language plpgsql security definer set search_path='' as $$
declare ws uuid:=public.orms_current_workspace();
begin
  if not public.orms_is_owner() then raise exception 'Only the workspace owner can change access' using errcode='42501'; end if;
  if not exists(select 1 from public.campaigns where id=p_campaign and workspace_id=ws) or not exists(select 1 from public.workspace_members where workspace_id=ws and user_id=p_user) then raise exception 'Member or campaign is outside this workspace'; end if;
  if p_role is null then delete from public.campaign_access where campaign_id=p_campaign and user_id=p_user;
  elsif p_role in ('manager','member','viewer') then
    insert into public.campaign_access(workspace_id,campaign_id,user_id,role) values(ws,p_campaign,p_user,p_role) on conflict(campaign_id,user_id) do update set role=excluded.role;
  else raise exception 'Choose a valid campaign role'; end if;
  -- Outstanding links must not restore permissions after an owner's edit.
  update public.team_invitations set revoked_at=now() where workspace_id=ws and accepted_at is null and revoked_at is null and email=(select lower(email) from auth.users where id=p_user);
  if p_role is null or p_role='viewer' then update public.tasks set assigned_to=null where workspace_id=ws and campaign_id=p_campaign and assigned_to=p_user and status='pending'; end if;
end; $$;
create or replace function public.orms_remove_member(p_user uuid) returns void language plpgsql security definer set search_path='' as $$
declare ws uuid:=public.orms_current_workspace();
begin
  if not public.orms_is_owner() or p_user=auth.uid() then raise exception 'Only the owner can remove a teammate' using errcode='42501'; end if;
  delete from public.workspace_members where workspace_id=ws and user_id=p_user;
  update public.team_invitations set revoked_at=now() where workspace_id=ws and accepted_at is null and revoked_at is null and email=(select lower(email) from auth.users where id=p_user);
  update public.tasks set assigned_to=null where workspace_id=ws and assigned_to=p_user and status='pending';
end; $$;

-- Work permissions still come from the selected campaign; the workspace guard
-- runs first and stamps ownership independently of the acting employee.

create or replace function public.orms_guard_campaign_work() returns trigger language plpgsql security definer set search_path='' as $$
declare owner uuid; linked_owner uuid; linked_lead uuid; actor uuid:=auth.uid(); role text;
begin
  -- FK cascades detach deleted campaigns/users. Their nested updates must keep
  -- the existing ON DELETE behavior rather than looking like a user move.
  if pg_trigger_depth()>1 then return new; end if;
  if tg_op='UPDATE' and (new.id<>old.id or new.user_id<>old.user_id or new.campaign_id is distinct from old.campaign_id or new.lead_id is distinct from old.lead_id) then
    raise exception 'A work record cannot be moved to a different campaign or lead' using errcode='23514';
  end if;
  if tg_op='UPDATE' then
    if tg_table_name='campaign_leads' then
      if new.added_at is distinct from old.added_at then raise exception 'Campaign membership dates cannot be changed'; end if;
    elsif new.created_at is distinct from old.created_at then raise exception 'Creation dates cannot be changed'; end if;
  end if;
  if new.campaign_id is not null and not exists(select 1 from public.campaigns where id=new.campaign_id and workspace_id=new.workspace_id) then raise exception 'Campaign belongs to a different workspace' using errcode='23514'; end if;
  if new.lead_id is not null and not exists(select 1 from public.leads where id=new.lead_id and workspace_id=new.workspace_id) then raise exception 'Lead belongs to a different workspace' using errcode='23514'; end if;
  if new.campaign_id is not null then
    select c.user_id into owner from public.campaigns c where c.id=new.campaign_id;
    role:=public.orms_campaign_role(new.campaign_id);
    if new.lead_id is not null and tg_table_name<>'campaign_leads' and not exists(select 1 from public.campaign_leads cl where cl.campaign_id=new.campaign_id and cl.lead_id=new.lead_id) then
      raise exception 'The lead is not in this campaign' using errcode='23514';
    end if;
  else owner:=new.user_id; end if;
  if new.lead_id is not null then
    select l.user_id into linked_owner from public.leads l where l.id=new.lead_id;
    if linked_owner is distinct from owner then raise exception 'Lead and campaign must belong to the same workspace' using errcode='23514'; end if;
  end if;
  if actor is not null and (owner is distinct from public.orms_current_owner() or (owner<>actor and not coalesce(role in ('manager','member'),false))) then
    raise exception 'You do not have permission to change this campaign' using errcode='42501';
  end if;
  new.user_id:=owner;
  if tg_table_name='activities' then
    if new.person_id is not null then
      select dm.lead_id into linked_lead from public.decision_makers dm where dm.id=new.person_id;
      if linked_lead is distinct from new.lead_id then raise exception 'The person is not linked to this lead' using errcode='23514'; end if;
    end if;
    if tg_op='INSERT' then
      new.actor_id:=actor;
      select coalesce(nullif(u.raw_user_meta_data->>'full_name',''),u.email) into new.actor_name from auth.users u where u.id=actor;
    elsif new.actor_id is distinct from old.actor_id or new.actor_name is distinct from old.actor_name then raise exception 'Activity attribution cannot be changed'; end if;
  elsif tg_table_name='tasks' then
    if tg_op='INSERT' then
      new.created_by:=actor;
      new.assigned_to:=coalesce(new.assigned_to,actor);
      if actor is not null and owner<>actor and coalesce(role,'')<>'manager' and new.assigned_to<>actor then
        raise exception 'Only an owner or manager can assign tasks to others' using errcode='42501';
      end if;
    else
      new.created_by:=old.created_by;
      if actor is not null and owner<>actor and coalesce(role,'')<>'manager' then
        if old.assigned_to is not null and old.assigned_to<>actor then raise exception 'This task belongs to another team member' using errcode='42501'; end if;
        if new.assigned_to is not null and new.assigned_to<>actor then raise exception 'Only an owner or manager can assign tasks to others' using errcode='42501'; end if;
        new.assigned_to:=coalesce(new.assigned_to,actor);
      end if;
    end if;
    if new.assigned_to is not null and (case when new.campaign_id is null then new.assigned_to<>owner else not public.orms_valid_assignee(new.assigned_to,new.campaign_id) end) then
      raise exception 'Assign this task to someone who can work on the campaign' using errcode='23514';
    end if;
    if new.status::text='completed' and (tg_op='INSERT' or old.status::text<>'completed') then new.completed_by:=actor; new.completed_at:=now();
    elsif tg_op='UPDATE' and new.status::text='completed' then new.completed_by:=old.completed_by; new.completed_at:=old.completed_at;
    else new.completed_by:=null; new.completed_at:=null; end if;
  end if;
  return new;
end; $$;

do $$ declare p record; begin
  for p in select tablename,policyname from pg_policies where schemaname='public' and tablename in
    ('workspaces','workspace_members','campaign_access','team_invitations','campaigns','campaign_leads','leads','lead_emails','lead_phones','decision_makers','activities','tasks','datasets','settings','notes','notifications','contact_channels','campaign_channels','google_calendar_tokens') loop
    execute format('drop policy %I on public.%I',p.policyname,p.tablename);
  end loop;
end; $$;
create policy workspace_read on public.workspaces for select to authenticated using(owner_id=auth.uid() or exists(select 1 from public.workspace_members m where m.workspace_id=workspaces.id and m.user_id=auth.uid()));
create policy workspace_update on public.workspaces for update to authenticated using(id=public.orms_current_workspace() and owner_id=auth.uid()) with check(id=public.orms_current_workspace() and owner_id=auth.uid());
revoke update on public.workspaces from authenticated;
grant update(name) on public.workspaces to authenticated;
create policy own_membership on public.workspace_members for select to authenticated using(user_id=auth.uid() or (workspace_id=public.orms_current_workspace() and public.orms_is_owner()));
create policy own_campaign_access on public.campaign_access for select to authenticated using(workspace_id=public.orms_current_workspace() and (user_id=auth.uid() or public.orms_is_owner()));
create policy invitation_owner_read on public.team_invitations for select to authenticated using(workspace_id=public.orms_current_workspace() and public.orms_is_owner());
create policy invitation_owner_revoke on public.team_invitations for update to authenticated using(workspace_id=public.orms_current_workspace() and public.orms_is_owner()) with check(workspace_id=public.orms_current_workspace() and public.orms_is_owner());
create policy campaign_read on public.campaigns for select to authenticated using(public.orms_campaign_role(id) is not null);
create policy campaign_owner on public.campaigns for all to authenticated using(workspace_id=public.orms_current_workspace() and public.orms_is_owner()) with check(workspace_id=public.orms_current_workspace() and public.orms_is_owner());
create policy membership_read on public.campaign_leads for select to authenticated using(workspace_id=public.orms_current_workspace() and public.orms_campaign_role(campaign_id) is not null);
create policy membership_owner on public.campaign_leads for all to authenticated using(workspace_id=public.orms_current_workspace() and public.orms_is_owner()) with check(workspace_id=public.orms_current_workspace() and public.orms_is_owner());
create policy membership_work on public.campaign_leads for update to authenticated using(public.orms_can_work(campaign_id)) with check(workspace_id=public.orms_current_workspace() and public.orms_can_work(campaign_id));
create policy lead_read on public.leads for select to authenticated using(public.orms_can_read_lead(id));
create policy lead_owner on public.leads for all to authenticated using(workspace_id=public.orms_current_workspace() and public.orms_is_owner()) with check(workspace_id=public.orms_current_workspace() and public.orms_is_owner());
do $$ declare t text; begin
  foreach t in array array['lead_emails','lead_phones','decision_makers'] loop
    execute format('create policy contact_read on public.%I for select to authenticated using(workspace_id=public.orms_current_workspace() and public.orms_can_read_lead(lead_id))',t);
    execute format('create policy contact_owner on public.%I for all to authenticated using(workspace_id=public.orms_current_workspace() and public.orms_is_owner()) with check(workspace_id=public.orms_current_workspace() and public.orms_is_owner())',t);
  end loop;
  foreach t in array array['datasets','notes','settings','contact_channels','notifications'] loop
    execute format('create policy owner_only on public.%I for all to authenticated using(workspace_id=public.orms_current_workspace() and public.orms_is_owner()) with check(workspace_id=public.orms_current_workspace() and public.orms_is_owner())',t);
  end loop;
end; $$;
create policy settings_read on public.settings for select to authenticated using(workspace_id=public.orms_current_workspace());
create policy activity_read on public.activities for select to authenticated using(workspace_id=public.orms_current_workspace() and (public.orms_is_owner() or public.orms_campaign_role(campaign_id) is not null));
create policy activity_insert on public.activities for insert to authenticated with check(workspace_id=public.orms_current_workspace() and (public.orms_is_owner() or public.orms_can_work(campaign_id)));
create policy activity_owner on public.activities for all to authenticated using(workspace_id=public.orms_current_workspace() and public.orms_is_owner()) with check(workspace_id=public.orms_current_workspace() and public.orms_is_owner());
create policy task_read on public.tasks for select to authenticated using(workspace_id=public.orms_current_workspace() and (public.orms_is_owner() or public.orms_campaign_role(campaign_id) is not null));
create policy task_insert on public.tasks for insert to authenticated with check(workspace_id=public.orms_current_workspace() and (public.orms_is_owner() or public.orms_can_work(campaign_id)));
create policy task_update on public.tasks for update to authenticated using(workspace_id=public.orms_current_workspace() and (public.orms_is_owner() or (public.orms_can_work(campaign_id) and (assigned_to=auth.uid() or assigned_to is null or public.orms_campaign_role(campaign_id)='manager'))))
  with check(workspace_id=public.orms_current_workspace() and (public.orms_is_owner() or public.orms_can_work(campaign_id)));
create policy task_delete on public.tasks for delete to authenticated using(workspace_id=public.orms_current_workspace() and public.orms_is_owner());
create policy calendar_read on public.google_calendar_tokens for select to authenticated using(workspace_id=public.orms_current_workspace() and user_id=auth.uid());
create policy calendar_delete on public.google_calendar_tokens for delete to authenticated using(workspace_id=public.orms_current_workspace() and user_id=auth.uid());
create policy campaign_channels_owner on public.campaign_channels for all to authenticated using(workspace_id=public.orms_current_workspace() and public.orms_is_owner()) with check(workspace_id=public.orms_current_workspace() and public.orms_is_owner());

-- Invoker functions must also filter by workspace instead of account ownership.
-- Views retain security_invoker=true and gain the new workspace column.
do $$ declare definition text; begin
  select pg_get_functiondef('public.search_leads(text,integer)'::regprocedure) into definition;
  execute replace(definition,'l.user_id = public.orms_current_owner()','l.workspace_id = public.orms_current_workspace()');
end; $$;
create or replace function public.seed_default_channels() returns integer language sql as $$
  with ins as (insert into public.contact_channels(user_id,workspace_id,key,label,capabilities,position)
    select public.orms_current_owner(),public.orms_current_workspace(),d.key,d.label,d.capabilities,d.position from public.default_contact_channels() d where public.orms_is_owner()
    on conflict(workspace_id,key) do nothing returning 1) select count(*)::int from ins;
$$;
alter function public.undo_quick_log(uuid[],uuid,uuid,integer,timestamptz,text) security invoker;

-- Recreate SELECT * views without discarding their existing dependent functions.
do $$ declare definition text; begin
  select pg_get_viewdef('public.no_next_step_leads',true) into definition;
  execute 'create or replace view public.no_next_step_leads with (security_invoker=true) as '||replace(definition,'l.custom_fields','l.custom_fields, l.workspace_id');
end; $$;
create or replace view public.lead_channel_touches with (security_invoker=true) as
select user_id,lead_id,channel,person_id,count(*) as touches,max(occurred_at) as last_touch_at,workspace_id
from public.activities where channel is not null and type::text in ('EMAIL_SENT','FOLLOWUP_SENT','CALL_ATTEMPTED','CALL_CONNECTED','VOICEMAIL')
group by user_id,lead_id,channel,person_id,workspace_id;

-- Delivery status is server-owned; clients may revoke an invitation only.
create function public.orms_mark_invitation_delivery(p_id uuid,p_status text) returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.role()<>'service_role' then raise exception 'Server access required' using errcode='42501'; end if;
  if p_status not in ('sent','failed','not_configured') then raise exception 'Invalid delivery status'; end if;
  update public.team_invitations set delivery_status=p_status,sent_at=case when p_status='sent' then now() else null end where id=p_id;
end; $$;
do $$ declare f record; begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'orms_%' loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    if f.signature::text not like '%orms_valid_assignee(%' and f.signature::text not like '%orms_mark_invitation_delivery(%' and f.signature::text not like '%orms_guard_%' then
      execute format('grant execute on function %s to authenticated',f.signature);
    end if;
  end loop;
end; $$;
grant execute on function public.orms_invitation_preview(text) to anon;
grant execute on function public.orms_mark_invitation_delivery(uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
