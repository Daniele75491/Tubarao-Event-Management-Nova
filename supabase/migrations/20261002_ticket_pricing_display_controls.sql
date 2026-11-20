-- Display preferences only. Apply after the already-live 20261001 pricing migration.
-- No pricing helper, reservation RPC, price, deadline or stored amount is changed.
begin;
do $$ begin
  if to_regprocedure('public.read_event_pricing(uuid)') is null then
    raise exception 'Apply 20261001_ticket_pricing.sql first';
  end if;
end; $$;
alter table public.events
  add column if not exists show_pricing_countdown boolean not null default false,
  add column if not exists show_late_price_before_start boolean not null default false;

create or replace function public.validate_pricing_input(p_values jsonb)
returns void language plpgsql set search_path=public as $$
declare k text;
begin
  foreach k in array array['show_pricing_countdown','show_late_price_before_start'] loop
    if p_values ? k and jsonb_typeof(p_values->k) is distinct from 'boolean' then raise exception 'INVALID_EVENT'; end if;
  end loop;
  foreach k in array array['early_price_cents','late_price_cents'] loop
    if p_values ? k and (jsonb_typeof(p_values->k) is distinct from 'number'
      or (p_values->>k) !~ '^[0-9]+$' or (p_values->>k)::numeric not between 1 and 100000)
      then raise exception 'INVALID_EVENT'; end if;
  end loop;
  if p_values ? 'pricing_mode' and (jsonb_typeof(p_values->'pricing_mode') is distinct from 'string'
    or p_values->>'pricing_mode' not in ('AUTO','EARLY','LATE')) then raise exception 'INVALID_EVENT'; end if;
end; $$;

create or replace function public.admin_update_event(p_event_id uuid,p_patch jsonb,p_admin_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.events; v_next public.events; v_total bigint; v_men bigint; v_guests bigint;
begin
  perform public.admin_event_role(p_admin_id);
  v := public.admin_locked_event(p_event_id);
  if p_patch is null or jsonb_typeof(p_patch)<>'object' or exists (
    select 1 from jsonb_object_keys(p_patch) k where k not in
    ('name','starts_at','physical_capacity','men_paid_cap','early_price_cents','late_price_cents','early_price_ends_at','pricing_mode','show_pricing_countdown','show_late_price_before_start','reservation_minutes','claim_hold_hours','sales_mode','sales_open_at','sales_close_at')
  ) then raise exception 'INVALID_EVENT'; end if;
  perform public.validate_pricing_input(p_patch);
  v_next := jsonb_populate_record(v,p_patch);
  perform public.admin_validate_event(v_next);
  -- Use both the old and new hold windows: shortening must not evade occupancy
  -- protection, and extending must account for any previously elapsed claims.
  select count(*),count(*) filter(where category='MEN') into v_total,v_men
    from public.reservations where event_id=v.id and (status='PAID'
    or (status='RESERVED' and reserved_until>now())
    or (status='PAYMENT_CLAIMED' and claimed_at+make_interval(hours=>greatest(v.claim_hold_hours,v_next.claim_hold_hours))>now()));
  select count(*) into v_guests from public.non_paying_attendees where event_id=v.id;
  if v_next.physical_capacity<v_total+v_guests then raise exception 'CAPACITY_TOO_LOW'; end if;
  if v_next.men_paid_cap<v_men then raise exception 'MEN_CAP_TOO_LOW'; end if;
  update public.events set name=trim(v_next.name),starts_at=v_next.starts_at,
    physical_capacity=v_next.physical_capacity,men_paid_cap=v_next.men_paid_cap,
    early_price_cents=v_next.early_price_cents,late_price_cents=v_next.late_price_cents,
    early_price_ends_at=v_next.early_price_ends_at,pricing_mode=v_next.pricing_mode,reservation_minutes=v_next.reservation_minutes,
    show_pricing_countdown=v_next.show_pricing_countdown,show_late_price_before_start=v_next.show_late_price_before_start,
    claim_hold_hours=v_next.claim_hold_hours,sales_mode=v_next.sales_mode,
    sales_open_at=v_next.sales_open_at,sales_close_at=v_next.sales_close_at,updated_at=now()
    where id=v.id returning * into v;
  return to_jsonb(v);
end; $$;

create or replace function public.admin_create_event(p_values jsonb,p_admin_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.events;
begin
  perform public.admin_event_role(p_admin_id,true);
  if p_values is null or jsonb_typeof(p_values)<>'object' or exists (
    select 1 from jsonb_object_keys(p_values) k where k not in
    ('name','starts_at','physical_capacity','men_paid_cap','early_price_cents','late_price_cents','early_price_ends_at','pricing_mode','show_pricing_countdown','show_late_price_before_start','reservation_minutes','claim_hold_hours','sales_mode','sales_open_at','sales_close_at')
  ) then raise exception 'INVALID_EVENT'; end if;
  perform public.validate_pricing_input(p_values);
  v := jsonb_populate_record(null::public.events,p_values);
  perform public.admin_validate_event(v);
  insert into public.events(name,starts_at,physical_capacity,men_paid_cap,ticket_price_cents,early_price_cents,late_price_cents,early_price_ends_at,pricing_mode,show_pricing_countdown,show_late_price_before_start,reservation_minutes,claim_hold_hours,sales_mode,sales_open_at,sales_close_at,is_active)
    values(trim(v.name),v.starts_at,v.physical_capacity,v.men_paid_cap,v.early_price_cents,v.early_price_cents,v.late_price_cents,v.early_price_ends_at,v.pricing_mode,coalesce(v.show_pricing_countdown,false),coalesce(v.show_late_price_before_start,false),v.reservation_minutes,v.claim_hold_hours,v.sales_mode,v.sales_open_at,v.sales_close_at,false)
    returning * into v;
  return to_jsonb(v);
end; $$;


revoke all on function public.validate_pricing_input(jsonb),public.admin_update_event(uuid,jsonb,uuid),public.admin_create_event(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.admin_update_event(uuid,jsonb,uuid),public.admin_create_event(jsonb,uuid) to service_role;
commit;
