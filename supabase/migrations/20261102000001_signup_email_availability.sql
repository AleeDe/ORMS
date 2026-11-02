begin;

-- Keep lookup counters outside the API schemas. Store a hash of the ingress
-- address, never the email being checked or a user's profile.
create schema if not exists orms_private;
revoke all on schema orms_private from public, anon, authenticated;
create table orms_private.signup_email_checks (
  client_hash text not null,
  window_start timestamptz not null,
  checks integer not null,
  primary key(client_hash, window_start)
);
alter table orms_private.signup_email_checks enable row level security;
revoke all on orms_private.signup_email_checks from public, anon, authenticated;
create index signup_email_checks_expiry on orms_private.signup_email_checks(window_start);

-- Signup intentionally exposes email availability, but no account metadata.
-- Both confirmed and unconfirmed accounts already own their email address.
create function public.orms_signup_email_available(p_email text) returns boolean
language plpgsql security definer set search_path='' as $$
declare
  recipient text := lower(trim(p_email));
  request_headers jsonb := coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb;
  client text;
  bucket timestamptz := date_trunc('minute',statement_timestamp());
  attempts integer;
begin
  if recipient is null or length(recipient)>254 or recipient !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Enter a valid email address.' using errcode='22023';
  end if;
  -- Supabase's Cloudflare ingress supplies this header. Use a shared fallback
  -- bucket when it is absent instead of trusting a caller's custom identity.
  client := coalesce(nullif(request_headers->>'cf-connecting-ip',''),'unknown');
  delete from orms_private.signup_email_checks where window_start<bucket-interval '10 minutes';
  insert into orms_private.signup_email_checks(client_hash,window_start,checks)
    values(encode(sha256(convert_to(client,'utf8')),'hex'),bucket,1)
    on conflict(client_hash,window_start) do update set checks=orms_private.signup_email_checks.checks+1
    returning checks into attempts;
  if attempts>60 then
    raise sqlstate 'PGRST' using
      message='{"code":"email_check_rate_limit","message":"Too many email checks. Wait a minute and try again.","details":null,"hint":null}',
      detail='{"status":429,"headers":{"Retry-After":"60"}}';
  end if;
  return not exists(select 1 from auth.users u where lower(u.email)=recipient);
end;
$$;
revoke all on function public.orms_signup_email_available(text) from public;
grant execute on function public.orms_signup_email_available(text) to anon, authenticated, service_role;
notify pgrst,'reload schema';
commit;
