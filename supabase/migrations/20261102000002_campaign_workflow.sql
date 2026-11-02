begin;

-- Work roles belong to a campaign assignment; access roles stay unchanged.
alter table public.campaign_access add column work_role text not null default 'full_cycle'
  check(work_role in ('appointment_setter','closer','full_cycle'));
alter table public.campaign_leads
  add column workflow_stage text not null default 'prospecting' check(workflow_stage in ('prospecting','qualified','won','lost')),
  add column qualified_at timestamptz,
  add column qualified_by uuid references auth.users(id) on delete set null,
  add column appointment_at timestamptz,
  add column assigned_closer_id uuid references auth.users(id) on delete set null,
  add column closed_at timestamptz,
  add column closed_by uuid references auth.users(id) on delete set null,
  add column workflow_version integer not null default 0;
alter table public.activities add column appointment_at timestamptz;
create index campaign_workflow_queue on public.campaign_leads(workspace_id,campaign_id,workflow_stage,assigned_closer_id);

-- Old statuses remain usable, without inventing a setter or a completion date.
update public.campaign_leads set workflow_stage=case status::text
  when 'interested_meeting' then 'qualified' when 'won' then 'won'
  when 'lost' then 'lost' when 'no_fit' then 'lost' else 'prospecting' end;

create table public.campaign_work_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  lead_ref uuid not null,
  actor_id uuid references auth.users(id) on delete set null,
  actor_ref uuid not null,
  actor_name text not null,
  work_role text not null,
  event_type text not null check(event_type in ('qualified','appointment_booked','won','lost','disqualified','assigned','rescheduled','reopened')),
  occurred_at timestamptz not null default now(),
  appointment_at timestamptz,
  closer_id uuid,
  foreign key(workspace_id,campaign_id) references public.campaigns(workspace_id,id) deferrable initially deferred,
  foreign key(workspace_id,lead_id) references public.leads(workspace_id,id) deferrable initially deferred,
  check(lead_id is null or lead_ref=lead_id),
  check(actor_id is null or actor_ref=actor_id)
);
create unique index campaign_work_milestone_once on public.campaign_work_events(campaign_id,lead_ref,event_type)
  where event_type in ('qualified','appointment_booked','won','lost','disqualified');
create index campaign_work_reporting on public.campaign_work_events(workspace_id,campaign_id,occurred_at,actor_ref);
alter table public.campaign_work_events enable row level security;
revoke all on public.campaign_work_events from public,anon,authenticated;
grant select on public.campaign_work_events to authenticated;
create policy campaign_work_event_read on public.campaign_work_events for select to authenticated
  using(workspace_id=public.orms_current_workspace() and public.orms_campaign_role(campaign_id) is not null);

create schema if not exists orms_private;
revoke all on schema orms_private from public,anon,authenticated;
create table orms_private.campaign_work_requests (
  request_id uuid primary key, actor_id uuid not null, request_hash text not null,
  response jsonb not null, created_at timestamptz not null default now()
);
create index campaign_work_request_expiry on orms_private.campaign_work_requests(created_at);
alter table orms_private.campaign_work_requests enable row level security;
revoke all on orms_private.campaign_work_requests from public,anon,authenticated;

create function public.orms_campaign_work_role(p_campaign uuid) returns text
language sql stable security definer set search_path='' as $$
  select case when public.orms_campaign_role(p_campaign)='owner' then 'full_cycle' else a.work_role end
  from public.campaigns c left join public.campaign_access a on a.campaign_id=c.id and a.user_id=auth.uid()
  where c.id=p_campaign and public.orms_campaign_role(c.id) is not null;
$$;
create function public.orms_valid_closer(p_campaign uuid,p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.campaigns c join public.workspaces w on w.id=c.workspace_id
    where c.id=p_campaign and (w.owner_id=p_user or exists(
      select 1 from public.campaign_access a join public.workspace_members m on m.workspace_id=a.workspace_id and m.user_id=a.user_id
      where a.campaign_id=c.id and a.workspace_id=c.workspace_id and a.user_id=p_user
      and a.role in ('manager','member') and a.work_role in ('closer','full_cycle'))));
$$;
revoke all on function public.orms_valid_closer(uuid,uuid) from public,anon,authenticated;

create function public.orms_campaign_team(p_campaign uuid)
returns table(user_id uuid,label text,access_role text,work_role text)
language plpgsql stable security definer set search_path='' as $$
begin
  if public.orms_campaign_role(p_campaign) is null then raise exception 'Campaign access required' using errcode='42501'; end if;
  return query select u.id,coalesce(nullif(u.raw_user_meta_data->>'full_name',''),u.email,'Team member'),
    case when u.id=w.owner_id then 'owner' else a.role end,
    case when u.id=w.owner_id then 'full_cycle' else a.work_role end
  from public.campaigns c join public.workspaces w on w.id=c.workspace_id
  join auth.users u on u.id=w.owner_id or exists(select 1 from public.campaign_access ca where ca.campaign_id=c.id and ca.user_id=u.id)
  left join public.campaign_access a on a.campaign_id=c.id and a.user_id=u.id
  where c.id=p_campaign order by 2;
end;
$$;
create function public.orms_set_campaign_work_role(p_campaign uuid,p_user uuid,p_work_role text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not coalesce(public.orms_campaign_role(p_campaign) in ('owner','manager'),false) then raise exception 'Only the campaign owner or manager can assign work roles' using errcode='42501'; end if;
  if p_work_role is null or p_work_role not in ('appointment_setter','closer','full_cycle') then raise exception 'Choose a valid work role'; end if;
  update public.campaign_access set work_role=p_work_role where campaign_id=p_campaign and user_id=p_user and workspace_id=public.orms_current_workspace();
  if not found then raise exception 'Assign campaign access before choosing a work role'; end if;
end;
$$;

-- Metadata, handoffs and versions are only writable through the workflow RPC.
-- Ordinary touch counters and existing status controls remain supported.
revoke update on public.campaign_leads from public,anon,authenticated;
grant update(status,touch_count,last_contacted_at) on public.campaign_leads to authenticated;
create function public.orms_pipeline_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); job text; manager boolean; prior text:='prospecting';
begin
  if actor is null then return new; end if;
  job:=public.orms_campaign_work_role(new.campaign_id);
  manager:=coalesce(public.orms_campaign_role(new.campaign_id) in ('owner','manager'),false);
  if tg_op='INSERT' then
    new.workflow_stage:='prospecting'; new.qualified_at:=null; new.qualified_by:=null;
    new.appointment_at:=null; new.assigned_closer_id:=null; new.closed_at:=null; new.closed_by:=null; new.workflow_version:=0;
  else prior:=old.workflow_stage; end if;
  if tg_op='INSERT' or new.status is distinct from old.status then
    if tg_op='UPDATE' and prior in ('won','lost') and not manager then raise exception 'Only an owner or manager can reopen or correct a closed lead' using errcode='42501'; end if;
    if new.status::text='interested_meeting' then
      if not manager and coalesce(job,'') not in ('appointment_setter','full_cycle') then raise exception 'An appointment setter qualifies leads' using errcode='42501'; end if;
      new.workflow_stage:='qualified';
    elsif new.status::text='won' or (new.status::text in ('lost','no_fit') and prior in ('qualified','won','lost')) then
      if not manager and (coalesce(job,'') not in ('closer','full_cycle') or prior not in ('qualified','won','lost')) then raise exception 'A closer handles qualified lead outcomes' using errcode='42501'; end if;
      if not manager and new.assigned_closer_id is not null and new.assigned_closer_id<>actor then raise exception 'This lead belongs to another closer' using errcode='42501'; end if;
      new.workflow_stage:=case when new.status::text='won' then 'won' else 'lost' end;
      new.assigned_closer_id:=coalesce(new.assigned_closer_id,actor);
    elsif new.status::text in ('lost','no_fit') then new.workflow_stage:='lost';
    elsif prior in ('won','lost') then
      if not manager then raise exception 'Only an owner or manager can reopen a lead' using errcode='42501'; end if;
      new.workflow_stage:='prospecting';
    end if;
  end if;
  if new.assigned_closer_id is not null and not public.orms_valid_closer(new.campaign_id,new.assigned_closer_id) then raise exception 'Choose a closer assigned to this campaign' using errcode='23514'; end if;
  if new.workflow_stage='qualified' and prior='prospecting' then
    new.qualified_at:=now(); new.qualified_by:=actor;
  end if;
  if new.workflow_stage in ('won','lost') and new.workflow_stage<>prior then new.closed_at:=now(); new.closed_by:=actor;
  elsif new.workflow_stage not in ('won','lost') then new.closed_at:=null; new.closed_by:=null; end if;
  if tg_op='UPDATE' and (new.workflow_stage is distinct from old.workflow_stage or new.appointment_at is distinct from old.appointment_at or new.assigned_closer_id is distinct from old.assigned_closer_id) then new.workflow_version:=old.workflow_version+1; end if;
  return new;
end;
$$;
create trigger orms_10_pipeline_guard before insert or update on public.campaign_leads for each row execute function public.orms_pipeline_guard();

create function public.orms_record_work_event(p_row public.campaign_leads,p_type text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then return; end if;
  insert into public.campaign_work_events(workspace_id,campaign_id,lead_id,lead_ref,actor_id,actor_ref,actor_name,work_role,event_type,appointment_at,closer_id)
  select p_row.workspace_id,p_row.campaign_id,p_row.lead_id,p_row.lead_id,u.id,u.id,
    coalesce(nullif(u.raw_user_meta_data->>'full_name',''),u.email,'Former team member'),coalesce(public.orms_campaign_work_role(p_row.campaign_id),'system'),p_type,p_row.appointment_at,p_row.assigned_closer_id
  from auth.users u where u.id=auth.uid() on conflict do nothing;
end;
$$;
revoke all on function public.orms_record_work_event(public.campaign_leads,text) from public,anon,authenticated;
create function public.orms_pipeline_events() returns trigger
language plpgsql security definer set search_path='' as $$
declare prior text:=case when tg_op='INSERT' then 'prospecting' else old.workflow_stage end;
begin
  if auth.uid() is null then return new; end if;
  if new.workflow_stage='qualified' and prior='prospecting' then perform public.orms_record_work_event(new,'qualified'); end if;
  if new.workflow_stage='won' and prior<>'won' then perform public.orms_record_work_event(new,'won'); end if;
  if new.workflow_stage='lost' and prior<>'lost' then perform public.orms_record_work_event(new,case when prior in ('qualified','won') then 'lost' else 'disqualified' end); end if;
  if new.workflow_stage='prospecting' and prior<>'prospecting' then perform public.orms_record_work_event(new,'reopened'); end if;
  if tg_op='UPDATE' then
    if new.assigned_closer_id is distinct from old.assigned_closer_id then
      perform public.orms_record_work_event(new,'assigned');
      -- A handoff moves unfinished meeting preparation with the lead, while
      -- completed task credit remains with the person who actually did it.
      update public.tasks set assigned_to=new.assigned_closer_id where campaign_id=new.campaign_id
        and lead_id=new.lead_id and workspace_id=new.workspace_id and type::text='meeting_reminder' and status::text='pending';
    end if;
    if new.appointment_at is not null and new.appointment_at is distinct from old.appointment_at then
      perform public.orms_record_work_event(new,case when old.appointment_at is null then 'appointment_booked' else 'rescheduled' end);
    end if;
  end if;
  return new;
end;
$$;
create trigger orms_pipeline_events after insert or update on public.campaign_leads for each row execute function public.orms_pipeline_events();

-- Every booking entry point qualifies the campaign membership automatically.
create function public.orms_meeting_handoff() returns trigger
language plpgsql security definer set search_path='' as $$
declare membership public.campaign_leads;
begin
  if new.type::text<>'MEETING_BOOKED' or auth.uid() is null then return new; end if;
  if new.campaign_id is null then raise exception 'Choose a campaign before booking an appointment'; end if;
  if not coalesce(public.orms_campaign_role(new.campaign_id) in ('owner','manager'),false) and coalesce(public.orms_campaign_work_role(new.campaign_id),'') not in ('appointment_setter','full_cycle') then raise exception 'An appointment setter books appointments' using errcode='42501'; end if;
  select * into membership from public.campaign_leads where campaign_id=new.campaign_id and lead_id=new.lead_id for update;
  if membership.id is null or membership.workspace_id<>new.workspace_id then raise exception 'This lead is not in the campaign'; end if;
  if membership.workflow_stage in ('won','lost') then raise exception 'Reopen this lead before booking another appointment'; end if;
  if new.appointment_at is not null and not isfinite(new.appointment_at) then raise exception 'Choose a valid appointment time'; end if;
  update public.campaign_leads set status='interested_meeting',appointment_at=coalesce(new.appointment_at,appointment_at)
    where id=membership.id returning * into membership;
  perform public.orms_record_work_event(membership,'appointment_booked');
  return new;
end;
$$;
create trigger orms_meeting_handoff after insert on public.activities for each row execute function public.orms_meeting_handoff();

create function public.orms_meeting_task_assignee() returns trigger
language plpgsql security definer set search_path='' as $$
declare closer uuid;
begin
  if auth.uid() is null or new.type::text<>'meeting_reminder' or new.status::text<>'pending' then return new; end if;
  select assigned_closer_id into closer from public.campaign_leads where campaign_id=new.campaign_id and lead_id=new.lead_id and workspace_id=new.workspace_id;
  if closer is not null and public.orms_valid_closer(new.campaign_id,closer) then new.assigned_to:=closer; end if;
  return new;
end;
$$;
-- Runs after the existing actor/assignment guard and only derives a target
-- from a validated campaign handoff, never from a client-supplied user id.
create trigger orms_z_meeting_task_assignee before insert on public.tasks for each row execute function public.orms_meeting_task_assignee();

create function public.orms_release_closer() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='DELETE' or not public.orms_valid_closer(new.campaign_id,new.user_id) then
    update public.campaign_leads set assigned_closer_id=null where campaign_id=old.campaign_id and assigned_closer_id=old.user_id;
  end if;
  return null;
end;
$$;
create trigger orms_release_closer after update of role,work_role or delete on public.campaign_access for each row execute function public.orms_release_closer();

create function public.orms_campaign_lead_action(p_campaign uuid,p_lead uuid,p_action text,p_request_id uuid,p_version integer,
  p_appointment_at timestamptz default null,p_closer uuid default null,p_note text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare member public.campaign_leads; manager boolean; job text; previous orms_private.campaign_work_requests; digest text; result jsonb;
begin
  if auth.uid() is null or not public.orms_can_work(p_campaign) then raise exception 'Campaign working access required' using errcode='42501'; end if;
  if p_request_id is null or p_version is null or p_action is null or p_action not in ('qualify','book','assign','claim','won','lost','reopen') then raise exception 'Choose a valid campaign action'; end if;
  if length(coalesce(p_note,''))>5000 then raise exception 'Keep the handoff note under 5,000 characters'; end if;
  digest:=encode(sha256(convert_to(jsonb_build_array(p_campaign,p_lead,p_action,p_version,p_appointment_at,p_closer,p_note)::text,'utf8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('orms:work-request:'||p_request_id::text,0));
  select * into previous from orms_private.campaign_work_requests where request_id=p_request_id;
  if found then
    if previous.actor_id<>auth.uid() or previous.request_hash<>digest then raise exception 'This request has already been used'; end if;
    return previous.response;
  end if;
  select * into member from public.campaign_leads where campaign_id=p_campaign and lead_id=p_lead and workspace_id=public.orms_current_workspace() for update;
  if member.id is null then raise exception 'The lead is not in this campaign'; end if;
  if member.workflow_version<>p_version then raise exception 'This lead changed. Refresh it before trying again.' using errcode='40001'; end if;
  manager:=coalesce(public.orms_campaign_role(p_campaign) in ('owner','manager'),false); job:=public.orms_campaign_work_role(p_campaign);
  if p_action in ('qualify','book') then
    if not manager and coalesce(job,'') not in ('appointment_setter','full_cycle') then raise exception 'An appointment setter qualifies leads and books appointments' using errcode='42501'; end if;
    if member.workflow_stage in ('won','lost') then raise exception 'Reopen this lead before qualifying it'; end if;
  end if;
  if p_closer is not null and not public.orms_valid_closer(p_campaign,p_closer) then raise exception 'Choose a closer assigned to this campaign'; end if;
  if p_action in ('qualify','book') and member.workflow_stage='qualified' and p_closer is not null
    and p_closer is distinct from member.assigned_closer_id and not manager and member.qualified_by is distinct from auth.uid()
    then raise exception 'Only the qualifier or campaign manager can change this handoff' using errcode='42501'; end if;
  if p_action='qualify' then
    update public.campaign_leads set status='interested_meeting',assigned_closer_id=coalesce(p_closer,assigned_closer_id) where id=member.id;
  elsif p_action='book' then
    if p_appointment_at is null or not isfinite(p_appointment_at) then raise exception 'Choose an appointment date and time'; end if;
    if p_closer is not null then update public.campaign_leads set assigned_closer_id=p_closer where id=member.id; end if;
    insert into public.activities(user_id,workspace_id,campaign_id,lead_id,type,content,appointment_at)
      values(public.orms_current_owner(),member.workspace_id,p_campaign,p_lead,'MEETING_BOOKED',nullif(trim(p_note),''),p_appointment_at);
  elsif p_action in ('assign','claim') then
    if member.workflow_stage<>'qualified' then raise exception 'Only qualified leads can be handed to a closer'; end if;
    if p_action='claim' then
      p_closer:=auth.uid();
      if not public.orms_valid_closer(p_campaign,p_closer) then raise exception 'A closer claims qualified leads' using errcode='42501'; end if;
      if not manager and member.assigned_closer_id is not null and member.assigned_closer_id<>auth.uid() then raise exception 'This lead belongs to another closer' using errcode='42501'; end if;
    elsif not manager and not (coalesce(job,'') in ('appointment_setter','full_cycle') and member.qualified_by=auth.uid()) then raise exception 'Only the qualifier or campaign manager can hand off this lead' using errcode='42501'; end if;
    update public.campaign_leads set assigned_closer_id=p_closer where id=member.id;
  elsif p_action in ('won','lost') then
    if member.workflow_stage<>'qualified' then raise exception 'Qualify the lead before recording a closing outcome'; end if;
    if not manager and (coalesce(job,'') not in ('closer','full_cycle') or (member.assigned_closer_id is not null and member.assigned_closer_id<>auth.uid())) then raise exception 'The assigned closer records the outcome' using errcode='42501'; end if;
    if p_action='won' then update public.campaign_leads set status='won' where id=member.id;
    else update public.campaign_leads set status='lost' where id=member.id; end if;
  elsif p_action='reopen' then
    if not manager then raise exception 'Only the campaign owner or manager can reopen a lead' using errcode='42501'; end if;
    update public.campaign_leads set status='new',workflow_stage='prospecting',qualified_at=null,qualified_by=null,appointment_at=null,assigned_closer_id=null where id=member.id;
  end if;
  if p_action<>'book' then
    insert into public.activities(user_id,workspace_id,campaign_id,lead_id,type,content)
      values(public.orms_current_owner(),member.workspace_id,p_campaign,p_lead,'STATUS_CHANGED',
        concat(case p_action when 'qualify' then 'Qualified for closing' when 'claim' then 'Claimed for closing' when 'assign' then 'Closer assignment updated' when 'won' then 'Closed won' when 'lost' then 'Closed lost' else 'Reopened campaign lead' end,
        case when nullif(trim(p_note),'') is not null then ': '||trim(p_note) else '' end));
  end if;
  select to_jsonb(cl) into result from public.campaign_leads cl where cl.id=member.id;
  delete from orms_private.campaign_work_requests where created_at<now()-interval '7 days';
  insert into orms_private.campaign_work_requests(request_id,actor_id,request_hash,response) values(p_request_id,auth.uid(),digest,result);
  return result;
end;
$$;

-- Public RPCs are scoped inside their bodies; trigger helpers are not callable.
revoke all on function public.orms_campaign_work_role(uuid),public.orms_campaign_team(uuid),public.orms_set_campaign_work_role(uuid,uuid,text),
  public.orms_campaign_lead_action(uuid,uuid,text,uuid,integer,timestamptz,uuid,text) from public,anon;
grant execute on function public.orms_campaign_work_role(uuid),public.orms_campaign_team(uuid),public.orms_set_campaign_work_role(uuid,uuid,text),
  public.orms_campaign_lead_action(uuid,uuid,text,uuid,integer,timestamptz,uuid,text) to authenticated;
revoke all on function public.orms_pipeline_guard(),public.orms_pipeline_events(),public.orms_meeting_handoff(),public.orms_meeting_task_assignee(),public.orms_release_closer() from public,anon,authenticated;

notify pgrst,'reload schema';
commit;
