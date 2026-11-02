-- Run as an administrator. Every user and counter created here is rolled back.
begin;
do $$
declare
  confirmed uuid:=gen_random_uuid(); pending uuid:=gen_random_uuid(); fresh uuid:=gen_random_uuid();
  rejected boolean; detail text;
begin
  insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
  values(confirmed,confirmed::text||'@example.invalid',now(),'{}'),(pending,pending::text||'@example.invalid',null,'{}');
  perform set_config('request.headers',jsonb_build_object('cf-connecting-ip','availability-test-'||gen_random_uuid())::text,true);
  execute 'set local role anon';
  if public.orms_signup_email_available(confirmed::text||'@example.invalid') then raise exception 'Confirmed account was available'; end if;
  if public.orms_signup_email_available('  '||upper(confirmed::text||'@example.invalid')||'  ') then raise exception 'Case or whitespace bypassed existing account'; end if;
  if public.orms_signup_email_available(pending::text||'@example.invalid') then raise exception 'Unconfirmed account was available'; end if;
  if not public.orms_signup_email_available(fresh::text||'@example.invalid') then raise exception 'New email was blocked'; end if;
  rejected:=false;
  begin perform 1 from auth.users; exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'Public caller can read auth users'; end if;
  rejected:=false;
  begin perform 1 from orms_private.signup_email_checks; exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'Public caller can access private counters'; end if;
  rejected:=false;
  begin perform public.orms_signup_email_available('bad'); exception when invalid_parameter_value then rejected:=true; end;
  if not rejected then raise exception 'Malformed email was accepted'; end if;
  perform set_config('request.headers',jsonb_build_object('cf-connecting-ip','rate-test-'||gen_random_uuid())::text,true);
  for n in 1..60 loop perform public.orms_signup_email_available(fresh::text||'@example.invalid'); end loop;
  rejected:=false;
  begin perform public.orms_signup_email_available(fresh::text||'@example.invalid');
  exception when sqlstate 'PGRST' then
    get stacked diagnostics detail=message_text;
    rejected:=(detail::jsonb->>'code')='email_check_rate_limit';
  end;
  if not rejected then raise exception 'Availability rate limit was not enforced'; end if;
  execute 'reset role';
end;
$$;
rollback;
