begin;

create index if not exists campaign_activity_actor_reporting on public.activities(workspace_id,campaign_id,occurred_at,actor_id);
create index if not exists campaign_task_completion_reporting on public.tasks(workspace_id,campaign_id,completed_at,completed_by);

-- Aggregate in Postgres, before any API row limit can truncate a busy campaign.
-- A manager sees managed campaigns only; workspace owners see all campaigns.
create function public.orms_campaign_performance(p_campaign uuid default null,p_from timestamptz default null,
  p_to timestamptz default null,p_timezone text default 'UTC') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; today date;
begin
  if auth.uid() is null or public.orms_current_workspace() is null then raise exception 'Workspace access required' using errcode='42501'; end if;
  if p_campaign is not null and not coalesce(public.orms_campaign_role(p_campaign) in ('owner','manager'),false) then raise exception 'Campaign owner or manager access required' using errcode='42501'; end if;
  if not public.orms_is_owner() and not exists(select 1 from public.campaigns c where c.workspace_id=public.orms_current_workspace() and public.orms_campaign_role(c.id)='manager') then raise exception 'Campaign owner or manager access required' using errcode='42501'; end if;
  if p_from is not null and not isfinite(p_from) or p_to is not null and not isfinite(p_to) or p_from>=p_to then raise exception 'Choose a valid reporting period'; end if;
  if p_timezone is null or not exists(select 1 from pg_timezone_names where name=p_timezone) then raise exception 'Choose a valid reporting timezone'; end if;
  today:=(now() at time zone p_timezone)::date;
  with
  campaigns as materialized (
    select c.id,c.name,w.owner_id from public.campaigns c join public.workspaces w on w.id=c.workspace_id
    where c.workspace_id=public.orms_current_workspace() and (p_campaign is null or c.id=p_campaign)
      and public.orms_campaign_role(c.id) in ('owner','manager')
  ),
  outreach as (
    select a.campaign_id,coalesce(a.actor_id::text,'unattributed') as actor_key,
      max(a.actor_name) as label,
      count(*) filter(where a.type::text in ('EMAIL_SENT','FOLLOWUP_SENT','CALL_ATTEMPTED','CALL_CONNECTED','VOICEMAIL')) as touches,
      count(*) filter(where a.type::text='EMAIL_REPLY') as replies
    from public.activities a join campaigns c on c.id=a.campaign_id
    where (p_from is null or a.occurred_at>=p_from) and (p_to is null or a.occurred_at<p_to)
    group by a.campaign_id,a.actor_id
  ),
  milestones as (
    select e.campaign_id,e.actor_ref::text as actor_key,max(e.actor_name) as label,
      count(*) filter(where e.event_type='qualified') as qualified,
      count(*) filter(where e.event_type='appointment_booked') as appointments,
      count(*) filter(where e.event_type='won') as won,
      count(*) filter(where e.event_type='lost') as lost,
      count(*) filter(where e.event_type='disqualified') as disqualified
    from public.campaign_work_events e join campaigns c on c.id=e.campaign_id
    where (p_from is null or e.occurred_at>=p_from) and (p_to is null or e.occurred_at<p_to)
    group by e.campaign_id,e.actor_ref
  ),
  finished as (
    select t.campaign_id,coalesce(t.completed_by::text,'unattributed') as actor_key,count(*) as completed_tasks
    from public.tasks t join campaigns c on c.id=t.campaign_id where t.status::text='completed'
      and (p_from is null or t.completed_at>=p_from) and (p_to is null or t.completed_at<p_to)
    group by t.campaign_id,t.completed_by
  ),
  workload as (
    select t.campaign_id,coalesce(t.assigned_to::text,'unassigned') as actor_key,
      count(*) as pending_tasks,count(*) filter(where t.due_date<today) as overdue_tasks
    from public.tasks t join campaigns c on c.id=t.campaign_id where t.status::text='pending'
    group by t.campaign_id,t.assigned_to
  ),
  current_people as (
    select c.id as campaign_id,u.id::text as actor_key,
      coalesce(nullif(u.raw_user_meta_data->>'full_name',''),u.email,'Team member') as label,
      case when c.owner_id=u.id then 'full_cycle' else a.work_role end as work_role,
      case when c.owner_id=u.id then 'owner' else a.role end as access_role,0 as priority
    from campaigns c join auth.users u on u.id=c.owner_id or exists(select 1 from public.campaign_access x where x.campaign_id=c.id and x.user_id=u.id)
    left join public.campaign_access a on a.campaign_id=c.id and a.user_id=u.id
  ),
  all_people as (
    select * from current_people
    union all select campaign_id,actor_key,coalesce(label,'Unattributed history'),'historical',null,1 from outreach
    union all select campaign_id,actor_key,label,'historical',null,1 from milestones
    union all select f.campaign_id,f.actor_key,coalesce(nullif(u.raw_user_meta_data->>'full_name',''),u.email,'Unattributed history'),'historical',null,2 from finished f left join auth.users u on u.id::text=f.actor_key
    union all select w.campaign_id,w.actor_key,coalesce(nullif(u.raw_user_meta_data->>'full_name',''),u.email,'Unassigned'),'historical',null,2 from workload w left join auth.users u on u.id::text=w.actor_key
  ),
  people as (
    select distinct on(campaign_id,actor_key) * from all_people order by campaign_id,actor_key,priority,label
  ),
  metrics as (
    select p.campaign_id,c.name as campaign_name,p.actor_key,p.label,p.work_role,p.access_role,
      coalesce(o.touches,0) as touches,coalesce(o.replies,0) as replies,
      coalesce(m.qualified,0) as qualified,coalesce(m.appointments,0) as appointments,
      coalesce(m.won,0) as won,coalesce(m.lost,0) as lost,coalesce(m.disqualified,0) as disqualified,
      coalesce(f.completed_tasks,0) as completed_tasks,coalesce(w.pending_tasks,0) as pending_tasks,coalesce(w.overdue_tasks,0) as overdue_tasks
    from people p join campaigns c on c.id=p.campaign_id
    left join outreach o using(campaign_id,actor_key) left join milestones m using(campaign_id,actor_key)
    left join finished f using(campaign_id,actor_key) left join workload w using(campaign_id,actor_key)
  ),
  pipeline as (
    select cl.campaign_id,count(*) as leads,
      count(*) filter(where cl.workflow_stage='prospecting') as prospecting,
      count(*) filter(where cl.workflow_stage='qualified') as qualified_queue,
      count(*) filter(where cl.workflow_stage='qualified' and cl.assigned_closer_id is null) as unassigned_qualified,
      count(*) filter(where cl.workflow_stage='won') as current_won,
      count(*) filter(where cl.workflow_stage='lost') as current_lost
    from public.campaign_leads cl join campaigns c on c.id=cl.campaign_id group by cl.campaign_id
  ),
  campaign_totals as (
    select c.id,c.name,coalesce(p.leads,0) as leads,coalesce(p.prospecting,0) as prospecting,
      coalesce(p.qualified_queue,0) as qualified_queue,coalesce(p.unassigned_qualified,0) as unassigned_qualified,
      coalesce(p.current_won,0) as current_won,coalesce(p.current_lost,0) as current_lost,
      coalesce(sum(m.touches),0) as touches,coalesce(sum(m.replies),0) as replies,
      coalesce(sum(m.qualified),0) as qualified,coalesce(sum(m.appointments),0) as appointments,
      coalesce(sum(m.won),0) as won,coalesce(sum(m.lost),0) as lost,coalesce(sum(m.disqualified),0) as disqualified,
      coalesce(sum(m.completed_tasks),0) as completed_tasks,coalesce(sum(m.pending_tasks),0) as pending_tasks,coalesce(sum(m.overdue_tasks),0) as overdue_tasks
    from campaigns c left join pipeline p on p.campaign_id=c.id left join metrics m on m.campaign_id=c.id
    group by c.id,c.name,p.leads,p.prospecting,p.qualified_queue,p.unassigned_qualified,p.current_won,p.current_lost
  )
  select jsonb_build_object('from',p_from,'to',p_to,'timezone',p_timezone,'as_of',now(),
    'members',coalesce((select jsonb_agg(to_jsonb(m) order by m.campaign_name,m.label) from metrics m),'[]'::jsonb),
    'campaigns',coalesce((select jsonb_agg(to_jsonb(c) order by c.name) from campaign_totals c),'[]'::jsonb),
    'totals',(select jsonb_build_object('touches',coalesce(sum(touches),0),'replies',coalesce(sum(replies),0),'qualified',coalesce(sum(qualified),0),'appointments',coalesce(sum(appointments),0),'won',coalesce(sum(won),0),'lost',coalesce(sum(lost),0),'disqualified',coalesce(sum(disqualified),0),'completed_tasks',coalesce(sum(completed_tasks),0),'pending_tasks',coalesce(sum(pending_tasks),0),'overdue_tasks',coalesce(sum(overdue_tasks),0),'leads',coalesce(sum(leads),0),'qualified_queue',coalesce(sum(qualified_queue),0),'unassigned_qualified',coalesce(sum(unassigned_qualified),0)) from campaign_totals)) into result;
  return result;
end;
$$;
revoke all on function public.orms_campaign_performance(uuid,timestamptz,timestamptz,text) from public,anon;
grant execute on function public.orms_campaign_performance(uuid,timestamptz,timestamptz,text) to authenticated;
notify pgrst,'reload schema';
commit;
