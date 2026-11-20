-- Apply AFTER 20260928_admin_event_management.sql, before deploying cookie-auth code.
-- No account codes or hashes are seeded. Historical Auth users/columns remain intact.
begin;

do $$
declare v record;
begin
  perform id,label,role,code_salt,code_hash,is_active,last_login_at from public.admin_access_accounts limit 0;
  perform id,account_id,session_token_hash,created_at,last_seen_at,expires_at,revoked_at from public.admin_sessions limit 0;
  perform confirmed_by_access_id,checked_in_by_access_id,checked_in_by,checked_in_at,updated_at from public.reservations limit 0;
  if to_regprocedure('public.admin_event_role(uuid,boolean)') is null then
    raise exception 'Apply the event-management migration first';
  end if;
  for v in select * from (values
    ('public.check_in_ticket(text,uuid)',array['p_qr_token_hash','p_admin_id']),
    ('public.check_in_reservation(uuid,uuid)',array['p_reservation_id','p_admin_id'])
  ) expected(signature,names) loop
    if not exists(select 1 from pg_proc where oid=to_regprocedure(v.signature)
      and prorettype='jsonb'::regtype and not proretset and proargnames=v.names) then
      raise exception 'Unexpected or missing check-in RPC signature: %. Stop and inspect the deployed definition.',v.signature;
    end if;
  end loop;
end; $$;

-- Credentials and session hashes must have no browser-table access.
alter table public.admin_access_accounts enable row level security;
alter table public.admin_sessions enable row level security;
revoke all on public.admin_access_accounts,public.admin_sessions from public,anon,authenticated;
grant select,update on public.admin_access_accounts to service_role;
grant select,insert,update,delete on public.admin_sessions to service_role;

-- Existing event RPCs call this helper. All event mutations now require an active
-- SUPER_ADMIN access account, including functions that previously passed false.
create or replace function public.admin_event_role(p_admin_id uuid,p_super boolean default false)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from public.admin_access_accounts where id=p_admin_id
    and is_active=true and role='SUPER_ADMIN') then raise exception 'FORBIDDEN'; end if;
end; $$;

create or replace function public.check_in_reservation(p_reservation_id uuid,p_admin_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v public.reservations%rowtype; v_event_id uuid;
begin
  if not exists(select 1 from public.admin_access_accounts where id=p_admin_id
    and is_active=true and role in ('ADMIN','SUPER_ADMIN')) then raise exception 'FORBIDDEN'; end if;
  -- The row lock makes concurrent door requests observe the first committed scan.
  select * into v from public.reservations where id=p_reservation_id for update;
  if not found or v.status<>'PAID' then return jsonb_build_object('result','INVALID'); end if;
  select id into v_event_id from public.events where is_active=true
    order by (sales_mode in ('OPEN','SCHEDULED')) desc,created_at desc,id desc limit 1;
  if v.event_id is distinct from v_event_id then return jsonb_build_object('result','INVALID'); end if;
  if v.checked_in_at is not null then
    return jsonb_build_object('result','ALREADY_CHECKED_IN','first_name',v.first_name,
      'last_name',v.last_name,'category',v.category,'checked_in_at',v.checked_in_at);
  end if;
  update public.reservations set checked_in_at=now(),checked_in_by_access_id=p_admin_id,updated_at=now()
    where id=v.id returning * into v;
  return jsonb_build_object('result','CHECKED_IN','first_name',v.first_name,
    'last_name',v.last_name,'category',v.category,'checked_in_at',v.checked_in_at);
end; $$;

create or replace function public.check_in_ticket(p_qr_token_hash text,p_admin_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  if not exists(select 1 from public.admin_access_accounts where id=p_admin_id
    and is_active=true and role in ('ADMIN','SUPER_ADMIN')) then raise exception 'FORBIDDEN'; end if;
  if p_qr_token_hash is null or p_qr_token_hash !~ '^[a-fA-F0-9]{64}$' then
    return jsonb_build_object('result','INVALID');
  end if;
  select id into v_id from public.reservations where qr_token_hash=lower(p_qr_token_hash) for update;
  if not found then return jsonb_build_object('result','INVALID'); end if;
  return public.check_in_reservation(v_id,p_admin_id);
end; $$;

-- Payment confirmation continues through confirm_payment, followed by the
-- SUPER_ADMIN-only server audit write to confirmed_by_access_id. No old audit
-- values are rewritten, and retries preserve the original actor in either model.
revoke all on function public.admin_event_role(uuid,boolean),public.check_in_ticket(text,uuid),public.check_in_reservation(uuid,uuid) from public,anon,authenticated;
grant execute on function public.check_in_ticket(text,uuid),public.check_in_reservation(uuid,uuid) to service_role;
commit;
