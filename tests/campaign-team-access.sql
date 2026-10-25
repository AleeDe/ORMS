-- Execute as an administrator after the team migration. No fixtures persist.
begin;
do $$
declare
  v_owner uuid:=gen_random_uuid(); v_other uuid:=gen_random_uuid();
  v_member uuid:=gen_random_uuid(); v_viewer uuid:=gen_random_uuid(); v_invited uuid:=gen_random_uuid(); v_manager uuid:=gen_random_uuid();
  v_a uuid:=gen_random_uuid(); v_b uuid:=gen_random_uuid(); v_c uuid:=gen_random_uuid();
  v_lead uuid:=gen_random_uuid(); v_private uuid:=gen_random_uuid(); v_task uuid:=gen_random_uuid(); v_other_task uuid:=gen_random_uuid();
  v_invite jsonb; v_actor uuid; v_owner_result uuid; v_count integer; v_rejected boolean; v_token text;
begin
  insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
  values(v_owner,v_owner::text||'@orms-test.invalid',now(),'{}'),(v_other,v_other::text||'@orms-test.invalid',now(),'{}'),
    (v_member,v_member::text||'@orms-test.invalid',now(),'{}'),(v_viewer,v_viewer::text||'@orms-test.invalid',now(),'{}'),
    (v_invited,v_invited::text||'@orms-test.invalid',now(),'{}'),(v_manager,v_manager::text||'@orms-test.invalid',now(),'{}');
  insert into public.workspaces(id,owner_id,name) values(v_owner,v_owner,'Rollback team'),(v_other,v_other,'Rollback outsider');
  insert into public.workspace_members(workspace_id,user_id) values(v_owner,v_member),(v_owner,v_viewer),(v_owner,v_manager);
  insert into public.campaigns(id,user_id,name) values(v_a,v_owner,'Rollback assigned'),(v_b,v_owner,'Rollback private'),(v_c,v_other,'Rollback outsider');
  insert into public.campaign_access(workspace_id,campaign_id,user_id,role) values(v_owner,v_a,v_member,'member'),(v_owner,v_a,v_viewer,'viewer'),(v_owner,v_a,v_manager,'manager');
  insert into public.leads(id,user_id,business_name) values(v_lead,v_owner,'Rollback shared lead'),(v_private,v_owner,'Rollback private lead');
  insert into public.campaign_leads(user_id,campaign_id,lead_id) values(v_owner,v_a,v_lead),(v_owner,v_b,v_lead),(v_owner,v_b,v_private);
  insert into public.activities(user_id,lead_id,campaign_id,type,content) values(v_owner,v_lead,v_b,'NOTE_ADDED','Private campaign history');
  insert into public.tasks(id,user_id,campaign_id,lead_id,title,due_date,assigned_to)
    values(v_task,v_owner,v_a,v_lead,'Rollback member task',current_date,v_member),(v_other_task,v_owner,v_a,v_lead,'Rollback owner task',current_date,v_owner);
  insert into public.datasets(user_id,name) values(v_owner,'Rollback private dataset');

  perform set_config('request.jwt.claim.sub',v_member::text,true);
  perform set_config('request.headers',jsonb_build_object('x-orms-workspace',v_owner)::text,true);
  execute 'set local role authenticated';
  if current_user<>'authenticated' or auth.uid()<>v_member then raise exception 'RLS test did not assume the member identity'; end if;
  if (select count(*) from public.campaigns)<>1 then raise exception 'Member can see an unassigned campaign'; end if;
  if (select count(*) from public.leads)<>1 then raise exception 'Member can see a private lead'; end if;
  if (select count(*) from public.campaign_leads)<>1 then raise exception 'Shared lead exposed another campaign membership'; end if;
  if exists(select 1 from public.activities) then raise exception 'Private activity leaked through the shared lead'; end if;
  if exists(select 1 from public.datasets) then raise exception 'Private dataset leaked'; end if;
  if (select count(*) from public.search_leads('Rollback',20))<>1 then raise exception 'Search ignored assigned lead scope'; end if;
  if (select count(*) from public.lead_filter_facts)<>1 then raise exception 'Filter view bypassed lead permissions'; end if;
  if (select count(*) from public.orms_workspaces())<>1 then raise exception 'Workspace discovery failed'; end if;

  insert into public.activities(user_id,campaign_id,lead_id,type,actor_id,actor_name)
    values(v_member,v_a,v_lead,'EMAIL_SENT',v_owner,'Forged actor') returning actor_id,user_id into v_actor,v_owner_result;
  if v_actor<>v_member or v_owner_result<>v_owner then raise exception 'Activity lost employee attribution or owner'; end if;
  update public.campaign_leads set touch_count=touch_count+1 where campaign_id=v_a;
  get diagnostics v_count=row_count;
  if v_count<>1 then raise exception 'Member cannot update assigned campaign progress'; end if;
  update public.leads set business_name='Forbidden edit' where id=v_lead;
  get diagnostics v_count=row_count;
  if v_count<>0 then raise exception 'Member changed shared master data'; end if;
  update public.tasks set status='completed',completed_by=v_owner where id=v_task;
  select completed_by into v_actor from public.tasks where id=v_task;
  if v_actor<>v_member then raise exception 'Task completion actor was forged'; end if;
  update public.tasks set status='completed' where id=v_other_task;
  get diagnostics v_count=row_count;
  if v_count<>0 then raise exception 'Member completed another employee task'; end if;
  v_rejected:=false;
  begin insert into public.tasks(user_id,campaign_id,lead_id,title,due_date,assigned_to) values(v_member,v_a,v_lead,'Forbidden assignment',current_date,v_owner);
  exception when insufficient_privilege then v_rejected:=true; end;
  if not v_rejected then raise exception 'Member assigned work to someone else'; end if;
  v_rejected:=false;
  begin insert into public.activities(user_id,campaign_id,lead_id,type) values(v_member,v_b,v_lead,'NOTE_ADDED');
  exception when insufficient_privilege then v_rejected:=true; end;
  if not v_rejected then raise exception 'Member wrote to an unassigned campaign'; end if;
  v_rejected:=false;
  begin perform public.orms_set_campaign_access(v_member,v_b,'manager');
  exception when insufficient_privilege then v_rejected:=true; end;
  if not v_rejected then raise exception 'Member escalated campaign access'; end if;
  v_rejected:=false;
  begin perform public.orms_team_data(); exception when insufficient_privilege then v_rejected:=true; end;
  if not v_rejected then raise exception 'Member read owner team administration'; end if;

  perform set_config('request.headers',jsonb_build_object('x-orms-workspace',v_other)::text,true);
  if public.orms_current_owner() is not null then raise exception 'An invalid selected workspace did not fail closed'; end if;
  if exists(select 1 from public.campaigns) then raise exception 'Forged workspace header granted access'; end if;
  perform set_config('request.headers',jsonb_build_object('x-orms-workspace',v_owner)::text,true);
  perform set_config('request.jwt.claim.sub',v_viewer::text,true);
  update public.campaign_leads set status='won' where campaign_id=v_a;
  get diagnostics v_count=row_count;
  if v_count<>0 then raise exception 'Viewer changed campaign progress'; end if;
  v_rejected:=false;
  begin insert into public.activities(user_id,campaign_id,lead_id,type) values(v_viewer,v_a,v_lead,'NOTE_ADDED');
  exception when insufficient_privilege then v_rejected:=true; end;
  if not v_rejected then raise exception 'Viewer logged outreach'; end if;

  perform set_config('request.jwt.claim.sub',v_manager::text,true);
  update public.tasks set assigned_to=v_member where id=v_other_task;
  get diagnostics v_count=row_count;
  if v_count<>1 then raise exception 'Manager cannot assign campaign work'; end if;

  perform set_config('request.jwt.claim.sub',v_owner::text,true);
  perform public.orms_set_campaign_access(v_member,v_a,'viewer');
  if exists(select 1 from public.tasks where id=v_other_task and assigned_to is not null) then raise exception 'Changing to viewer did not release pending assignments'; end if;
  perform public.orms_set_campaign_access(v_member,v_a,'member');
  if (select count(*) from public.campaigns)<>2 then raise exception 'Owner lost existing campaign visibility'; end if;
  v_invite:=public.orms_create_invitation(v_invited::text||'@orms-test.invalid',jsonb_build_array(jsonb_build_object('campaign_id',v_a,'role','member')));
  v_token:=v_invite->>'token';
  if length(v_token)<>64 then raise exception 'Invalid invitation token'; end if;
  perform set_config('request.jwt.claim.sub',v_member::text,true);
  v_rejected:=false;
  begin perform public.orms_accept_invitation(v_token); exception when raise_exception then
    if sqlerrm like 'Sign in with the email%' then v_rejected:=true; else raise; end if;
  end;
  if not v_rejected then raise exception 'Wrong email accepted an invitation'; end if;
  perform set_config('request.jwt.claim.sub',v_invited::text,true);
  v_owner_result:=public.orms_accept_invitation(v_token);
  if v_owner_result<>v_owner then raise exception 'Invitation joined the wrong workspace'; end if;
  if public.orms_campaign_role(v_a)<>'member' or public.orms_campaign_role(v_b) is not null then raise exception 'Invitation granted incorrect campaigns'; end if;
  v_rejected:=false;
  begin perform public.orms_accept_invitation(v_token); exception when raise_exception then
    if sqlerrm like 'This invitation has expired%' then v_rejected:=true; else raise; end if;
  end;
  if not v_rejected then raise exception 'Invitation was reusable'; end if;
  perform set_config('request.jwt.claim.sub',v_owner::text,true);
  perform public.orms_remove_member(v_member);
  if not exists(select 1 from public.orms_roster() where user_id=v_member) then raise exception 'Owner lost the completed-task employee label after removal'; end if;
  perform set_config('request.jwt.claim.sub',v_member::text,true);
  if exists(select 1 from public.campaigns) or exists(select 1 from public.activities) or exists(select 1 from public.tasks) then raise exception 'Removed teammate retained workspace access'; end if;
  execute 'reset role';
  if not exists(select 1 from public.activities where user_id=v_owner and actor_id=v_member) then raise exception 'Revoking membership deleted activity history'; end if;
  if not exists(select 1 from public.tasks where id=v_task and completed_by=v_member) then raise exception 'Revoking membership erased completion attribution'; end if;
  if exists(select 1 from public.tasks where user_id=v_owner and assigned_to=v_member and status='pending') then raise exception 'Removed teammate kept pending assignments'; end if;
  delete from auth.users where id=v_owner;
  if exists(select 1 from public.tasks where user_id=v_owner) then raise exception 'Existing account cascade cleanup was broken'; end if;
end;
$$;
rollback;
