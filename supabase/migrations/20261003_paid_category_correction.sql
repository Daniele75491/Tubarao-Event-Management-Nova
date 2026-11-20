-- Apply manually after 20261002. No table columns or existing functions change.
begin;
create or replace function public.admin_change_paid_category(p_reservation_id uuid,p_category text,p_admin_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_event_id uuid; v_event public.events%rowtype; v public.reservations%rowtype; v_men bigint;
begin
  perform public.admin_event_role(p_admin_id,true);
  if p_category is null or p_category not in ('MEN','WOMEN') then raise exception 'INVALID_CATEGORY'; end if;
  -- Discover the event without taking the reservation lock first. Keep the same
  -- event advisory -> event row -> reservation row order as create_reservation.
  select event_id into v_event_id from public.reservations where id=p_reservation_id;
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtext(v_event_id::text));
  select * into v_event from public.events where id=v_event_id for update;
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;
  select * into v from public.reservations where id=p_reservation_id for update;
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;
  if v.event_id is distinct from v_event_id or v.status is distinct from 'PAID' or v.checked_in_at is not null then
    raise exception 'CATEGORY_NOT_EDITABLE';
  end if;
  if v.category::text=p_category then
    return jsonb_build_object('reservation_id',v.id,'category',v.category,'changed',false);
  end if;
  if p_category='MEN' then
    select count(*) into v_men from public.reservations where event_id=v_event_id and category='MEN' and (
      status='PAID' or (status='RESERVED' and reserved_until>now())
      or (status='PAYMENT_CLAIMED' and claimed_at+make_interval(hours=>v_event.claim_hold_hours)>now()));
    if v_men>=v_event.men_paid_cap then raise exception 'MEN_TICKETS_FULL'; end if;
  end if;
  -- Exact locked identity; no repricing, ticket generation, email or audit rewrite.
  update public.reservations set category=p_category::public.ticket_category
    where id=v.id and status='PAID' and checked_in_at is null;
  return jsonb_build_object('reservation_id',v.id,'category',p_category,'changed',true);
end; $$;
revoke all on function public.admin_change_paid_category(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.admin_change_paid_category(uuid,text,uuid) to service_role;
commit;
