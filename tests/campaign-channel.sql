-- Run against a migrated Supabase database as a database administrator.
-- All fixture data, including updates, is discarded by the final rollback.
begin;
do $$
declare
  owner_id uuid;
  lead_id uuid;
  email_campaign uuid;
  phone_campaign uuid;
  original_activity uuid;
  recorded_channel text;
begin
  select id into owner_id from auth.users limit 1;
  if owner_id is null then raise exception 'A fixture owner is required'; end if;

  insert into public.leads(user_id, business_name)
    values(owner_id, 'Rollback-only channel regression') returning id into lead_id;
  insert into public.campaigns(user_id, name, default_channel)
    values(owner_id, 'Rollback-only email campaign', 'clinic_email') returning id into email_campaign;
  insert into public.campaigns(user_id, name, default_channel)
    values(owner_id, 'Rollback-only phone campaign', 'clinic_phone') returning id into phone_campaign;
  insert into public.campaign_leads(user_id,campaign_id,lead_id)
    values(owner_id,email_campaign,lead_id),(owner_id,phone_campaign,lead_id);

  insert into public.activities(user_id, lead_id, campaign_id, type, channel)
    values(owner_id, lead_id, email_campaign, 'EMAIL_SENT', 'personal_email')
    returning id, channel into original_activity, recorded_channel;
  if recorded_channel is distinct from 'clinic_email' then
    raise exception 'Email campaign did not apply its fixed channel';
  end if;

  insert into public.activities(user_id, lead_id, campaign_id, type, channel)
    values(owner_id, lead_id, phone_campaign, 'CALL_CONNECTED', 'clinic_email')
    returning channel into recorded_channel;
  if recorded_channel is distinct from 'clinic_phone' then
    raise exception 'Phone campaign inherited another campaign channel';
  end if;

  begin
    insert into public.activities(user_id, lead_id, campaign_id, type)
      values(owner_id, lead_id, email_campaign, 'CALL_ATTEMPTED');
    raise exception 'Fixed writing channel accepted a call';
  exception when check_violation then null;
  end;
  begin
    insert into public.activities(user_id, lead_id, campaign_id, type)
      values(owner_id, lead_id, phone_campaign, 'EMAIL_SENT');
    raise exception 'Fixed phone channel accepted an email';
  exception when check_violation then null;
  end;

  insert into public.activities(user_id, lead_id, campaign_id, type)
    values(owner_id, lead_id, email_campaign, 'NOTE_ADDED') returning channel into recorded_channel;
  if recorded_channel is not null then raise exception 'A note was counted as channel outreach'; end if;

  update public.campaigns set default_channel='whatsapp' where id=email_campaign;
  select channel into recorded_channel from public.activities where id=original_activity;
  if recorded_channel is distinct from 'clinic_email' then raise exception 'Historical channel was changed'; end if;

  insert into public.activities(user_id, lead_id, campaign_id, type)
    values(owner_id, lead_id, email_campaign, 'EMAIL_SENT') returning channel into recorded_channel;
  if recorded_channel is distinct from 'whatsapp' then raise exception 'New outreach ignored the changed setting'; end if;

  update public.campaigns set default_channel=null where id=email_campaign;
  insert into public.activities(user_id, lead_id, campaign_id, type, channel)
    values(owner_id, lead_id, email_campaign, 'EMAIL_SENT', 'personal_email') returning channel into recorded_channel;
  if recorded_channel is distinct from 'personal_email' then raise exception 'Per-touch selection was not preserved'; end if;

  insert into public.activities(user_id, lead_id, campaign_id, type, channel)
    values(owner_id, lead_id, null, 'EMAIL_SENT', 'personal_email') returning channel into recorded_channel;
  if recorded_channel is distinct from 'personal_email' then raise exception 'Library history inherited a campaign channel'; end if;
end;
$$;
rollback;
