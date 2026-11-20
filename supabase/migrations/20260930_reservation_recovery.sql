-- Apply after event-management and access-auth migrations, before deploying recovery.
-- Existing tables, prices, deadlines, QR identity and reservation RPCs are unchanged.
begin;

do $$
begin
  if to_regprocedure('public.admin_locked_event(uuid)') is null
    or to_regprocedure('public.confirm_payment(uuid)') is null then
    raise exception 'Apply existing event/payment RPCs before reservation recovery';
  end if;
  perform confirmed_by_access_id,confirmed_by from public.reservations limit 0;
  perform id,role,is_active from public.admin_access_accounts limit 0;
end; $$;

create or replace function public.confirm_external_payment(p_reservation_id uuid,p_admin_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v public.reservations%rowtype;
  e public.events%rowtype;
  v_event_id uuid;
  v_total bigint;
  v_men bigint;
  v_guests bigint;
  v_result jsonb;
  v_now timestamptz;
begin
  if not exists(select 1 from public.admin_access_accounts where id=p_admin_id
    and is_active=true and role='SUPER_ADMIN') then raise exception 'FORBIDDEN'; end if;

  -- Match claim/confirm's reservation advisory lock BEFORE taking table locks.
  -- No reservation row lock is held while waiting for the event capacity lock.
  perform pg_advisory_xact_lock(hashtext(p_reservation_id::text));
  select event_id into v_event_id from public.reservations where id=p_reservation_id;
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;
  -- Shared protocol with create_reservation and admin capacity/non-paying edits:
  -- global/event advisory locks, event row, then both occupancy table locks.
  e := public.admin_locked_event(v_event_id);
  select * into v from public.reservations where id=p_reservation_id for update;
  if not found or v.event_id<>e.id then raise exception 'RESERVATION_NOT_FOUND'; end if;
  v_now := clock_timestamp();

  -- Materialize elapsed holds under the write locks before reclaiming capacity.
  -- This also prevents an already-started claim/confirm transaction using its old
  -- now() from reviving a hold that this transaction no longer counted. Conflicting
  -- in-flight row writes must finish first or PostgreSQL aborts a deadlock safely.
  update public.reservations set status='EXPIRED',expired_at=v_now,updated_at=v_now
    where event_id=e.id and ((status='RESERVED' and reserved_until<=v_now)
      or (status='PAYMENT_CLAIMED' and (claimed_at is null
        or claimed_at+make_interval(hours=>e.claim_hold_hours)<=v_now)));
  if v.status='PAYMENT_CLAIMED' and (v.claimed_at is null
    or v.claimed_at+make_interval(hours=>e.claim_hold_hours)<=v_now) then
    return jsonb_build_object('reservation_id',v.id,'status','EXPIRED');
  end if;

  if v.status='PAYMENT_CLAIMED' then
    -- Preserve normal claim deadline behavior, including expiry and idempotency.
    v_result := public.confirm_payment(v.id);
    if v_result->>'status'<>'PAID' then return v_result; end if;
  elsif v.status in ('RESERVED','EXPIRED') then
    -- Exclude this row: a live hold already occupies its slot; an expired one must
    -- reacquire it. The locked snapshot counts every other currently protected slot.
    select count(*),count(*) filter(where category='MEN') into v_total,v_men
      from public.reservations where event_id=e.id and id<>v.id and
      (status='PAID' or (status='RESERVED' and reserved_until>v_now)
       or (status='PAYMENT_CLAIMED' and claimed_at+make_interval(hours=>e.claim_hold_hours)>v_now));
    select count(*) into v_guests from public.non_paying_attendees where event_id=e.id;
    if v_total+v_guests>=e.physical_capacity then raise exception 'EVENT_SOLD_OUT'; end if;
    if v.category='MEN' and v_men>=e.men_paid_cap then raise exception 'MEN_SOLD_OUT'; end if;
    -- The existing unique active-email index also prevents resurrection beside
    -- another active reservation for the same email. Any conflict rolls back.
    update public.reservations set status='PAID',paid_at=v_now,updated_at=v_now where id=v.id;
  elsif v.status<>'PAID' then
    raise exception 'INVALID_RESERVATION_STATUS';
  end if;

  -- Actor attribution and payment commit together. Preserve all original actors.
  update public.reservations set confirmed_by_access_id=p_admin_id
    where id=v.id and confirmed_by_access_id is null and confirmed_by is null;
  select * into v from public.reservations where id=v.id;
  return jsonb_build_object('reservation_id',v.id,'status',v.status,'paid_at',v.paid_at);
end; $$;

revoke all on function public.confirm_external_payment(uuid,uuid) from public,anon,authenticated;
grant execute on function public.confirm_external_payment(uuid,uuid) to service_role;
commit;
