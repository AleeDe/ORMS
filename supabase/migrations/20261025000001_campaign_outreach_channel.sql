begin;

alter table public.campaigns
  add column if not exists default_channel text
  constraint campaigns_default_channel_check check (
    default_channel is null or default_channel in (
      'clinic_email', 'clinic_phone', 'personal_email', 'personal_phone',
      'whatsapp', 'linkedin', 'contact_form', 'in_person', 'other'
    )
  );

comment on column public.campaigns.default_channel is
  'NULL allows a channel per touch; a value fixes new outreach to that campaign channel. Legacy clinic keys are displayed as business channels.';

create or replace function public.enforce_campaign_outreach_channel()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  fixed_channel text;
begin
  if new.campaign_id is null or new.type::text not in (
    'EMAIL_SENT', 'FOLLOWUP_SENT', 'EMAIL_REPLY', 'CALL_ATTEMPTED',
    'CALL_CONNECTED', 'VOICEMAIL', 'MEETING_BOOKED', 'MEETING_COMPLETED'
  ) then
    return new;
  end if;

  select c.default_channel into fixed_channel
    from public.campaigns c where c.id = new.campaign_id;

  if fixed_channel is null then
    return new;
  end if;

  if fixed_channel in ('clinic_email', 'personal_email', 'contact_form', 'linkedin')
     and new.type::text in ('CALL_ATTEMPTED', 'CALL_CONNECTED', 'VOICEMAIL') then
    raise exception 'Calls cannot be logged through this campaign''s fixed writing channel.'
      using errcode = '23514';
  end if;

  if fixed_channel in ('clinic_phone', 'personal_phone')
     and new.type::text in ('EMAIL_SENT', 'FOLLOWUP_SENT', 'EMAIL_REPLY') then
    raise exception 'Email outreach cannot be logged through this campaign''s fixed phone channel.'
      using errcode = '23514';
  end if;

  new.channel := fixed_channel;
  return new;
end;
$$;

drop trigger if exists orms_campaign_outreach_channel on public.activities;
create trigger orms_campaign_outreach_channel
  before insert on public.activities
  for each row execute function public.enforce_campaign_outreach_channel();

notify pgrst, 'reload schema';
commit;
