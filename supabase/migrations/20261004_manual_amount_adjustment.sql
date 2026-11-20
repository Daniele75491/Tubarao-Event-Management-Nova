-- Apply manually after 20261003_paid_category_correction.sql. No old migration changes.
begin;
create table public.reservation_amount_adjustments (
  id uuid primary key default gen_random_uuid(),
  -- Deliberate immutable ID snapshot, not a cascading/blocking reservation FK:
  -- audit history must survive the existing explicit ticket deletion feature.
  reservation_id uuid not null,
  previous_amount_cents integer not null check (previous_amount_cents>=0),
  new_amount_cents integer not null check (new_amount_cents between 1 and 100000),
  adjusted_at timestamptz not null default now(),
  adjusted_by_access_id uuid not null references public.admin_access_accounts(id),
  reason text not null default 'MANUAL_ADJUSTMENT' check (reason='MANUAL_ADJUSTMENT')
);
create index reservation_amount_adjustments_reservation_idx on public.reservation_amount_adjustments(reservation_id,adjusted_at);
alter table public.reservation_amount_adjustments enable row level security;
revoke all on public.reservation_amount_adjustments from public,anon,authenticated,service_role;
grant select on public.reservation_amount_adjustments to service_role;

-- JSONB preserves input type, avoiding implicit coercion of strings/fractions to integer.
create or replace function public.admin_adjust_reservation_amount(p_reservation_id uuid,p_amount_cents jsonb,p_admin_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v public.reservations%rowtype; v_amount integer;
begin
  perform public.admin_event_role(p_admin_id,true);
  if jsonb_typeof(p_amount_cents) is distinct from 'number' then raise exception 'INVALID_AMOUNT'; end if;
  if p_amount_cents::text !~ '^[0-9]+$' or (p_amount_cents::text)::numeric not between 1 and 100000 then raise exception 'INVALID_AMOUNT'; end if;
  v_amount := (p_amount_cents::text)::integer;
  -- Only the target row is needed: no event/capacity/pricing writes or locks.
  -- This serializes adjustments, payment, category edits, check-in and deletion.
  select * into v from public.reservations where id=p_reservation_id for update;
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;
  if v.status is null or v.status not in ('RESERVED','PAYMENT_CLAIMED','PAID') then raise exception 'AMOUNT_NOT_EDITABLE'; end if;
  if v.amount_cents=v_amount then
    return jsonb_build_object('reservation_id',v.id,'amount_cents',v.amount_cents,'changed',false);
  end if;
  insert into public.reservation_amount_adjustments(reservation_id,previous_amount_cents,new_amount_cents,adjusted_by_access_id)
    values(v.id,v.amount_cents,v_amount,p_admin_id);
  update public.reservations set amount_cents=v_amount where id=v.id;
  return jsonb_build_object('reservation_id',v.id,'amount_cents',v_amount,'changed',true);
end; $$;
revoke all on function public.admin_adjust_reservation_amount(uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.admin_adjust_reservation_amount(uuid,jsonb,uuid) to service_role;
commit;
