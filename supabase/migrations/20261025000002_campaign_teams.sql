begin;

-- Existing user_id columns remain the workspace owner's id. This preserves all
-- imported records and separates their ownership from the employee doing work.
create table public.workspaces (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  name text not null default 'My workspace' check (length(trim(name)) between 1 and 100),
  created_at timestamptz not null default now()
);
insert into public.workspaces(owner_id)
select distinct user_id from public.campaigns union select distinct user_id from public.leads
union select distinct user_id from public.datasets on conflict do nothing;

create table public.workspace_members (
  owner_id uuid not null references public.workspaces(owner_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key(owner_id,user_id), check(owner_id <> user_id)
);
create index on public.workspace_members(user_id);
create table public.campaign_access (
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check(role in ('manager','member','viewer')),
  primary key(campaign_id,user_id)
);
create index on public.campaign_access(user_id);
create index if not exists campaign_leads_lead_access_idx on public.campaign_leads(lead_id,campaign_id);
create table public.team_invitations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.workspaces(owner_id) on delete cascade,
  email text not null,
  token_hash text not null unique,
  grants jsonb not null,
  expires_at timestamptz not null default now() + interval '7 days',
  created_at timestamptz not null default now(),
  accepted_at timestamptz, accepted_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz
);

alter table public.activities add column actor_id uuid references auth.users(id) on delete set null,
  add column actor_name text;
alter table public.tasks add column assigned_to uuid references auth.users(id) on delete set null,
  add column created_by uuid references auth.users(id) on delete set null,
  add column completed_by uuid references auth.users(id) on delete set null;
create index on public.tasks(assigned_to,campaign_id);

create function public.orms_current_owner() returns uuid language plpgsql stable security definer set search_path='' as $$
declare selected uuid; raw text;
begin
  if auth.uid() is null then return null; end if;
  raw := nullif(current_setting('request.headers',true),'')::jsonb ->> 'x-orms-workspace';
  if raw is null or raw='' then return auth.uid(); end if;
  if raw ~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then selected := raw::uuid; end if;
  if selected=auth.uid() or exists(select 1 from public.workspace_members m where m.owner_id=selected and m.user_id=auth.uid()) then return selected; end if;
  return null;
end; $$;

create function public.orms_campaign_role(p_campaign uuid) returns text language sql stable security definer set search_path='' as $$
  select case when c.user_id=auth.uid() then 'owner' else a.role end
  from public.campaigns c left join public.campaign_access a on a.campaign_id=c.id and a.user_id=auth.uid()
  where c.id=p_campaign and c.user_id=public.orms_current_owner()
    and (c.user_id=auth.uid() or exists(select 1 from public.workspace_members m where m.owner_id=c.user_id and m.user_id=auth.uid()));
$$;
create function public.orms_can_work(p_campaign uuid) returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(public.orms_campaign_role(p_campaign) in ('owner','manager','member'),false);
$$;
create function public.orms_can_read_lead(p_lead uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.leads l where l.id=p_lead and l.user_id=public.orms_current_owner()
    and (l.user_id=auth.uid() or exists(select 1 from public.campaign_leads cl where cl.lead_id=l.id and public.orms_campaign_role(cl.campaign_id) is not null)));
$$;
create function public.orms_valid_assignee(p_user uuid,p_campaign uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.campaigns c where c.id=p_campaign and
    (c.user_id=p_user or exists(select 1 from public.workspace_members m join public.campaign_access a on a.user_id=m.user_id
      where m.owner_id=c.user_id and m.user_id=p_user and a.campaign_id=c.id and a.role in ('manager','member'))));
$$;
revoke all on function public.orms_valid_assignee(uuid,uuid) from public,anon,authenticated;

create function public.orms_workspaces() returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Sign in to continue'; end if;
  if not exists(select 1 from public.workspaces w where w.owner_id=auth.uid())
    and not exists(select 1 from public.workspace_members m where m.user_id=auth.uid()) then
    insert into public.workspaces(owner_id) values(auth.uid()) on conflict do nothing;
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('owner_id',w.owner_id,'name',w.name,'is_owner',w.owner_id=auth.uid(),
    'campaigns',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'role',case when c.user_id=auth.uid() then 'owner' else a.role end))
      from public.campaigns c left join public.campaign_access a on a.campaign_id=c.id and a.user_id=auth.uid()
      where c.user_id=w.owner_id and (w.owner_id=auth.uid() or a.role is not null)),'[]'::jsonb)) order by w.created_at)
    from public.workspaces w where w.owner_id=auth.uid() or exists(select 1 from public.workspace_members m where m.owner_id=w.owner_id and m.user_id=auth.uid())),'[]'::jsonb);
end; $$;

create function public.orms_roster() returns table(user_id uuid,label text) language sql stable security definer set search_path='' as $$
  select u.id, coalesce(nullif(u.raw_user_meta_data->>'full_name',''),u.email,'Team member')
  from auth.users u where
    (u.id=public.orms_current_owner() or exists(select 1 from public.workspace_members m where m.owner_id=public.orms_current_owner() and m.user_id=u.id)
      or (auth.uid()=public.orms_current_owner() and exists(select 1 from public.tasks t where t.user_id=auth.uid() and t.completed_by=u.id)))
    and (auth.uid()=public.orms_current_owner() or u.id=auth.uid() or exists(
      select 1 from public.campaigns c left join public.campaign_access a on a.campaign_id=c.id and a.user_id=u.id
      where public.orms_campaign_role(c.id) is not null and (c.user_id=u.id or a.role is not null)))
  order by 2;
$$;

create function public.orms_campaign_workers(p_campaign uuid) returns table(user_id uuid,label text) language sql stable security definer set search_path='' as $$
  select u.id, coalesce(nullif(u.raw_user_meta_data->>'full_name',''),u.email,'Team member')
  from auth.users u where public.orms_campaign_role(p_campaign) is not null and public.orms_valid_assignee(u.id,p_campaign) order by 2;
$$;

create function public.orms_team_data() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare owner uuid := public.orms_current_owner();
begin
  if auth.uid() is null or owner is distinct from auth.uid() then raise exception 'Only the workspace owner can manage the team' using errcode='42501'; end if;
  return jsonb_build_object(
    'members',coalesce((select jsonb_agg(jsonb_build_object('user_id',u.id,'email',u.email,
      'label',coalesce(nullif(u.raw_user_meta_data->>'full_name',''),u.email),
      'open_tasks',(select count(*) from public.tasks t where t.user_id=owner and t.assigned_to=u.id and t.status='pending'),
      'completed_tasks',(select count(*) from public.tasks t where t.user_id=owner and t.completed_by=u.id and t.status='completed'),
      'overdue_tasks',(select count(*) from public.tasks t where t.user_id=owner and t.assigned_to=u.id and t.status='pending' and t.due_date<current_date),
      'touches',(select count(*) from public.activities a where a.user_id=owner and a.actor_id=u.id and a.type::text in ('EMAIL_SENT','FOLLOWUP_SENT','CALL_ATTEMPTED','CALL_CONNECTED'))))
      from auth.users u where u.id=owner or exists(select 1 from public.workspace_members m where m.owner_id=owner and m.user_id=u.id)),'[]'::jsonb),
    'campaigns',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name) order by c.name) from public.campaigns c where c.user_id=owner),'[]'::jsonb),
    'access',coalesce((select jsonb_agg(to_jsonb(a)) from public.campaign_access a join public.campaigns c on c.id=a.campaign_id where c.user_id=owner),'[]'::jsonb),
    'invitations',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'email',i.email,'expires_at',i.expires_at,'accepted_at',i.accepted_at,'revoked_at',i.revoked_at) order by i.created_at desc) from public.team_invitations i where i.owner_id=owner),'[]'::jsonb));
end; $$;

create function public.orms_create_invitation(p_email text,p_grants jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare owner uuid:=public.orms_current_owner(); token text; invite public.team_invitations; grant_row jsonb;
begin
  if auth.uid() is null or owner is distinct from auth.uid() then raise exception 'Only the workspace owner can invite members' using errcode='42501'; end if;
  if lower(trim(p_email)) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(p_email)>254 then raise exception 'Enter a valid email'; end if;
  if jsonb_typeof(p_grants)<>'array' or jsonb_array_length(p_grants) not between 1 and 100 then raise exception 'Choose at least one campaign'; end if;
  for grant_row in select * from jsonb_array_elements(p_grants) loop
    if grant_row->>'role' not in ('manager','member','viewer') or grant_row->>'role' is null
      or not exists(select 1 from public.campaigns c where c.id=(grant_row->>'campaign_id')::uuid and c.user_id=owner) then raise exception 'Invalid campaign access'; end if;
  end loop;
  update public.team_invitations set revoked_at=now() where owner_id=owner and email=lower(trim(p_email)) and accepted_at is null and revoked_at is null;
  token:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
  insert into public.team_invitations(owner_id,email,token_hash,grants)
    values(owner,lower(trim(p_email)),encode(sha256(convert_to(token,'utf8')),'hex'),p_grants) returning * into invite;
  return jsonb_build_object('id',invite.id,'token',token,'expires_at',invite.expires_at);
end; $$;

create function public.orms_accept_invitation(p_token text) returns uuid language plpgsql security definer set search_path='' as $$
declare invite public.team_invitations; grant_row jsonb; verified_email text;
begin
  if auth.uid() is null then raise exception 'Sign in to accept this invitation'; end if;
  select lower(email) into verified_email from auth.users where id=auth.uid() and email_confirmed_at is not null;
  if verified_email is null then raise exception 'Confirm your email address before accepting'; end if;
  select * into invite from public.team_invitations where token_hash=encode(sha256(convert_to(p_token,'utf8')),'hex') for update;
  if invite.id is null or invite.revoked_at is not null or invite.accepted_at is not null or invite.expires_at<=now() then raise exception 'This invitation has expired, was revoked, or has already been used'; end if;
  if invite.email<>verified_email then raise exception 'Sign in with the email address this invitation was issued to'; end if;
  if invite.owner_id=auth.uid() then raise exception 'You already own this workspace'; end if;
  insert into public.workspace_members(owner_id,user_id) values(invite.owner_id,auth.uid()) on conflict do nothing;
  for grant_row in select * from jsonb_array_elements(invite.grants) loop
    if not exists(select 1 from public.campaigns c where c.id=(grant_row->>'campaign_id')::uuid and c.user_id=invite.owner_id) then raise exception 'A campaign in this invitation is no longer available'; end if;
    insert into public.campaign_access(campaign_id,user_id,role) values((grant_row->>'campaign_id')::uuid,auth.uid(),grant_row->>'role')
      on conflict(campaign_id,user_id) do update set role=excluded.role;
  end loop;
  update public.team_invitations set accepted_at=now(),accepted_by=auth.uid() where id=invite.id;
  return invite.owner_id;
end; $$;

create function public.orms_set_campaign_access(p_user uuid,p_campaign uuid,p_role text) returns void language plpgsql security definer set search_path='' as $$
declare owner uuid:=public.orms_current_owner();
begin
  if auth.uid() is null or owner is distinct from auth.uid() then raise exception 'Only the workspace owner can change access' using errcode='42501'; end if;
  if not exists(select 1 from public.campaigns c where c.id=p_campaign and c.user_id=owner)
    or not exists(select 1 from public.workspace_members m where m.owner_id=owner and m.user_id=p_user) then raise exception 'Member or campaign is outside this workspace'; end if;
  if p_role is null then delete from public.campaign_access where campaign_id=p_campaign and user_id=p_user;
  elsif p_role in ('manager','member','viewer') then
    insert into public.campaign_access(campaign_id,user_id,role) values(p_campaign,p_user,p_role) on conflict(campaign_id,user_id) do update set role=excluded.role;
  else raise exception 'Choose a valid campaign role'; end if;
  if p_role is null or p_role='viewer' then
    update public.tasks set assigned_to=null where campaign_id=p_campaign and assigned_to=p_user and status='pending';
  end if;
end; $$;
create function public.orms_remove_member(p_user uuid) returns void language plpgsql security definer set search_path='' as $$
declare owner uuid:=public.orms_current_owner();
begin
  if auth.uid() is null or owner is distinct from auth.uid() or p_user=owner then raise exception 'Only the owner can remove a teammate' using errcode='42501'; end if;
  delete from public.campaign_access a using public.campaigns c where a.campaign_id=c.id and c.user_id=owner and a.user_id=p_user;
  delete from public.workspace_members where owner_id=owner and user_id=p_user;
  update public.tasks set assigned_to=null where user_id=owner and assigned_to=p_user and status='pending';
end; $$;

-- Triggers retain the owner on shared records and obtain attribution from the
-- authenticated session, never from a client-supplied employee id or name.
create function public.orms_guard_campaign_work() returns trigger language plpgsql security definer set search_path='' as $$
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
create trigger orms_guard_work before insert or update on public.activities for each row execute function public.orms_guard_campaign_work();
create trigger orms_guard_work before insert or update on public.tasks for each row execute function public.orms_guard_campaign_work();
create trigger orms_guard_work before insert or update on public.campaign_leads for each row execute function public.orms_guard_campaign_work();

-- Remove old permissive owner policies before adding the workspace boundaries.
do $$ declare p record; begin
  for p in select tablename,policyname from pg_policies where schemaname='public' and tablename in
    ('campaigns','campaign_leads','leads','lead_emails','lead_phones','decision_makers','activities','tasks','datasets','settings','notes') loop
    execute format('drop policy %I on public.%I',p.policyname,p.tablename);
  end loop;
end; $$;
create policy campaign_read on public.campaigns for select to authenticated using (public.orms_campaign_role(id) is not null);
create policy campaign_owner on public.campaigns for all to authenticated using(user_id=auth.uid() and user_id=public.orms_current_owner()) with check(user_id=auth.uid() and user_id=public.orms_current_owner());
create policy membership_read on public.campaign_leads for select to authenticated using(user_id=public.orms_current_owner() and public.orms_campaign_role(campaign_id) is not null);
create policy membership_owner on public.campaign_leads for all to authenticated using(user_id=auth.uid() and user_id=public.orms_current_owner()) with check(user_id=auth.uid() and user_id=public.orms_current_owner());
create policy membership_work on public.campaign_leads for update to authenticated using(public.orms_can_work(campaign_id)) with check(user_id=public.orms_current_owner() and public.orms_can_work(campaign_id));
create policy lead_read on public.leads for select to authenticated using(public.orms_can_read_lead(id));
create policy lead_owner on public.leads for all to authenticated using(user_id=auth.uid() and user_id=public.orms_current_owner()) with check(user_id=auth.uid() and user_id=public.orms_current_owner());
do $$ declare t text; begin
  foreach t in array array['lead_emails','lead_phones','decision_makers'] loop
    execute format('create policy contact_read on public.%I for select to authenticated using(user_id=public.orms_current_owner() and public.orms_can_read_lead(lead_id))',t);
    execute format('create policy contact_owner on public.%I for all to authenticated using(user_id=auth.uid() and user_id=public.orms_current_owner()) with check(user_id=auth.uid() and user_id=public.orms_current_owner())',t);
  end loop;
  foreach t in array array['datasets','notes','settings'] loop
    execute format('create policy owner_only on public.%I for all to authenticated using(user_id=auth.uid() and user_id=public.orms_current_owner()) with check(user_id=auth.uid() and user_id=public.orms_current_owner())',t);
  end loop;
end; $$;
create policy settings_read on public.settings for select to authenticated using(user_id=public.orms_current_owner());
create policy activity_read on public.activities for select to authenticated using(user_id=public.orms_current_owner() and (user_id=auth.uid() or public.orms_campaign_role(campaign_id) is not null));
create policy activity_insert on public.activities for insert to authenticated with check(user_id=public.orms_current_owner() and (user_id=auth.uid() or public.orms_can_work(campaign_id)));
create policy activity_owner on public.activities for all to authenticated using(user_id=auth.uid() and user_id=public.orms_current_owner()) with check(user_id=auth.uid() and user_id=public.orms_current_owner());
create policy task_read on public.tasks for select to authenticated using(user_id=public.orms_current_owner() and (user_id=auth.uid() or public.orms_campaign_role(campaign_id) is not null));
create policy task_insert on public.tasks for insert to authenticated with check(user_id=public.orms_current_owner() and (user_id=auth.uid() or public.orms_can_work(campaign_id)));
create policy task_update on public.tasks for update to authenticated using(user_id=public.orms_current_owner() and (user_id=auth.uid() or (public.orms_can_work(campaign_id) and (assigned_to=auth.uid() or assigned_to is null or public.orms_campaign_role(campaign_id)='manager'))))
  with check(user_id=public.orms_current_owner() and (user_id=auth.uid() or public.orms_can_work(campaign_id)));
create policy task_delete on public.tasks for delete to authenticated using(user_id=auth.uid() and user_id=public.orms_current_owner());

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.campaign_access enable row level security;
alter table public.team_invitations enable row level security;
create policy workspace_read on public.workspaces for select to authenticated using(owner_id=auth.uid() or exists(select 1 from public.workspace_members m where m.owner_id=workspaces.owner_id and m.user_id=auth.uid()));
create policy workspace_update on public.workspaces for update to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());
create policy own_membership on public.workspace_members for select to authenticated using(user_id=auth.uid() or owner_id=auth.uid());
create policy own_campaign_access on public.campaign_access for select to authenticated using(user_id=auth.uid() or public.orms_campaign_role(campaign_id)='owner');
create policy invitation_owner_read on public.team_invitations for select to authenticated using(owner_id=auth.uid() and owner_id=public.orms_current_owner());
create policy invitation_owner_revoke on public.team_invitations for update to authenticated using(owner_id=auth.uid() and owner_id=public.orms_current_owner()) with check(owner_id=auth.uid() and owner_id=public.orms_current_owner());
-- Invitations must only be changed through their specific operations.
revoke update on public.team_invitations from authenticated;
grant update(revoked_at) on public.team_invitations to authenticated;

-- Search keeps its existing shape; RLS now supplies the campaign restriction.
do $$ declare definition text; begin
  select pg_get_functiondef('public.search_leads(text,integer)'::regprocedure) into definition;
  execute replace(definition,'l.user_id = auth.uid()','l.user_id = public.orms_current_owner()');
end; $$;

do $$ declare f record; begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'orms_%' and p.proname<>'orms_valid_assignee' loop
    execute format('revoke all on function %s from public,anon',f.signature);
    execute format('grant execute on function %s to authenticated',f.signature);
  end loop;
end; $$;
notify pgrst,'reload schema';
commit;
