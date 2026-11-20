-- Apply manually AFTER the three existing migrations, before deploying pricing UI.
-- Existing amounts/QRs are untouched. Re-running does not reset configured prices.
begin;

do $$
begin
  if to_regprocedure('public.create_reservation(uuid,text,text,text,public.ticket_category)') is null
    or to_regprocedure('public.admin_locked_event(uuid)') is null then
    raise exception 'Existing reservation and event-management RPCs are required';
  end if;
  perform confirmed_by_access_id from public.reservations limit 0;
  perform id,role,is_active from public.admin_access_accounts limit 0;
end; $$;

alter table public.events add column if not exists early_price_cents integer;
alter table public.events add column if not exists late_price_cents integer;
alter table public.events add column if not exists early_price_ends_at timestamptz;
alter table public.events add column if not exists pricing_mode text not null default 'AUTO';
alter table public.reservations add column if not exists pricing_tier text;

-- Fail without changes if legacy event prices need an operator's decision.
do $$ begin
  if exists(select 1 from public.events where
    coalesce(early_price_cents,ticket_price_cents) not between 1 and 100000
    or coalesce(late_price_cents,ticket_price_cents) not between 1 and 100000) then
    raise exception 'Existing event prices must be between 1 and 100000 cents; review before migration';
  end if;
end; $$;
update public.events set early_price_cents=coalesce(early_price_cents,ticket_price_cents),
  late_price_cents=coalesce(late_price_cents,ticket_price_cents)
  where early_price_cents is null or late_price_cents is null;
alter table public.events alter column early_price_cents set not null;
alter table public.events alter column late_price_cents set not null;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.events'::regclass and conname='events_ticket_pricing_valid') then
    alter table public.events add constraint events_ticket_pricing_valid check (
      early_price_cents between 1 and 100000 and late_price_cents between 1 and 100000
      and pricing_mode in ('AUTO','EARLY','LATE')
      and (early_price_ends_at is null or isfinite(early_price_ends_at)));
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.reservations'::regclass and conname='reservations_pricing_tier_valid') then
    alter table public.reservations add constraint reservations_pricing_tier_valid
      check (pricing_tier is null or pricing_tier in ('EARLY','LATE'));
  end if;
end; $$;
comment on column public.events.ticket_price_cents is 'Legacy compatibility snapshot only. New pricing uses early/late fields.';
comment on column public.reservations.pricing_tier is 'Locked at creation; NULL means unknown legacy tier. Never infer from current event.';

-- Internal helper accepts a timestamp for deterministic boundary testing. Neither
-- public clients nor create_reservation can supply its pricing timestamp.
create or replace function public.event_pricing(p_event public.events,p_now timestamptz default now())
returns jsonb language sql stable set search_path=public as $$
  select jsonb_build_object('server_now',p_now,'phase',phase,
    'current_price_cents',case when phase='EARLY' then p_event.early_price_cents else p_event.late_price_cents end,
    'next_price_cents',case when phase='EARLY' then p_event.late_price_cents else null end,
    'early_price_ends_at',case when phase='EARLY' and p_event.pricing_mode='AUTO' then p_event.early_price_ends_at else null end)
  from (select case when p_event.pricing_mode='LATE' or
    (p_event.pricing_mode='AUTO' and p_event.early_price_ends_at is not null and p_now>=p_event.early_price_ends_at)
    then 'LATE' else 'EARLY' end as phase) s;
$$;
create or replace function public.read_event_pricing(p_event_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v public.events;
begin
  select * into v from public.events where id=p_event_id;
  if not found then raise exception 'EVENT_NOT_FOUND'; end if;
  return public.event_pricing(v,now());
end; $$;

-- Same supplied creation contract and locking/capacity rules. Pricing is selected
-- under the event lock and inserted in this transaction using database NOW().
create or replace function public.create_reservation(
  p_event_id uuid,p_first_name text,p_last_name text,p_email text,p_category public.ticket_category
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_event public.events%rowtype; v_active_count integer; v_non_paying_count integer;
  v_men_count integer; v_reservation_id uuid; v_reserved_until timestamptz; v_email text; v_pricing jsonb;
begin
  perform pg_advisory_xact_lock(hashtext(p_event_id::text));
  v_email := lower(trim(p_email));
  select * into v_event from public.events where id=p_event_id and is_active=true for update;
  if not found then raise exception 'EVENT_NOT_FOUND'; end if;
  update public.reservations set status='EXPIRED',expired_at=now()
    where event_id=p_event_id and status='RESERVED' and reserved_until<=now();
  update public.reservations set status='EXPIRED',expired_at=now()
    where event_id=p_event_id and status='PAYMENT_CLAIMED' and claimed_at is not null
      and claimed_at+make_interval(hours=>v_event.claim_hold_hours)<=now();
  if v_event.sales_mode='CLOSED' then raise exception 'SALES_CLOSED'; end if;
  if v_event.sales_mode='SCHEDULED' and (v_event.sales_open_at is null or now()<v_event.sales_open_at
    or (v_event.sales_close_at is not null and now()>v_event.sales_close_at)) then raise exception 'SALES_CLOSED'; end if;
  if exists(select 1 from public.reservations where event_id=p_event_id and lower(email)=v_email
    and status in ('RESERVED','PAYMENT_CLAIMED','PAID')) then raise exception 'ACTIVE_RESERVATION_EXISTS'; end if;
  select count(*) into v_active_count from public.reservations where event_id=p_event_id and (
    status='PAID' or (status='RESERVED' and reserved_until>now())
    or (status='PAYMENT_CLAIMED' and claimed_at+make_interval(hours=>v_event.claim_hold_hours)>now()));
  select count(*) into v_non_paying_count from public.non_paying_attendees where event_id=p_event_id;
  if v_active_count+v_non_paying_count>=v_event.physical_capacity then raise exception 'EVENT_SOLD_OUT'; end if;
  if p_category='MEN' then
    select count(*) into v_men_count from public.reservations where event_id=p_event_id and category='MEN' and (
      status='PAID' or (status='RESERVED' and reserved_until>now())
      or (status='PAYMENT_CLAIMED' and claimed_at+make_interval(hours=>v_event.claim_hold_hours)>now()));
    if v_men_count>=v_event.men_paid_cap then raise exception 'MEN_SOLD_OUT'; end if;
  end if;
  v_pricing := public.event_pricing(v_event,now());
  v_reserved_until := now()+make_interval(mins=>v_event.reservation_minutes);
  insert into public.reservations(event_id,first_name,last_name,email,category,amount_cents,pricing_tier,status,reserved_until)
    values(p_event_id,trim(p_first_name),trim(p_last_name),v_email,p_category,
      (v_pricing->>'current_price_cents')::integer,v_pricing->>'phase','RESERVED',v_reserved_until)
    returning id into v_reservation_id;
  return jsonb_build_object('reservation_id',v_reservation_id,'status','RESERVED',
    'amount_cents',(v_pricing->>'current_price_cents')::integer,'pricing_tier',v_pricing->>'phase',
    'reserved_until',v_reserved_until);
end; $$;

-- Validate JSON before populate_record: PostgreSQL integer casts alone must not
-- round fractional JSON values or accept string prices.
create or replace function public.validate_pricing_input(p_values jsonb)
returns void language plpgsql set search_path=public as $$
declare k text;
begin
  foreach k in array array['early_price_cents','late_price_cents'] loop
    if p_values ? k and (jsonb_typeof(p_values->k) is distinct from 'number'
      or (p_values->>k) !~ '^[0-9]+$' or (p_values->>k)::numeric not between 1 and 100000)
      then raise exception 'INVALID_EVENT'; end if;
  end loop;
  if p_values ? 'pricing_mode' and (jsonb_typeof(p_values->'pricing_mode') is distinct from 'string'
    or p_values->>'pricing_mode' not in ('AUTO','EARLY','LATE')) then raise exception 'INVALID_EVENT'; end if;
end; $$;

-- Management function replacements follow below; existing locks are preserved.

create or replace function public.admin_validate_event(p_event public.events)
returns void language plpgsql set search_path = public as $$
begin
  if p_event.name is null or length(trim(p_event.name)) not between 1 and 120
    or p_event.physical_capacity is null or p_event.physical_capacity<=0
    or p_event.men_paid_cap is null or p_event.men_paid_cap<0 or p_event.men_paid_cap>p_event.physical_capacity
    or p_event.early_price_cents is null or p_event.early_price_cents not between 1 and 100000
    or p_event.late_price_cents is null or p_event.late_price_cents not between 1 and 100000
    or p_event.pricing_mode is null or p_event.pricing_mode not in ('AUTO','EARLY','LATE')
    or (p_event.early_price_ends_at is not null and not isfinite(p_event.early_price_ends_at))
    or p_event.reservation_minutes is null or p_event.reservation_minutes<=0
    or p_event.claim_hold_hours is null or p_event.claim_hold_hours<=0
    or p_event.sales_mode is null
    or (p_event.sales_mode='SCHEDULED' and p_event.sales_open_at is null)
    or (p_event.sales_open_at is not null and p_event.sales_close_at is not null and p_event.sales_close_at<=p_event.sales_open_at)
  then raise exception 'INVALID_EVENT'; end if;
end; $$;

create or replace function public.admin_update_event(p_event_id uuid,p_patch jsonb,p_admin_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.events; v_next public.events; v_total bigint; v_men bigint; v_guests bigint;
begin
  perform public.admin_event_role(p_admin_id);
  v := public.admin_locked_event(p_event_id);
  if p_patch is null or jsonb_typeof(p_patch)<>'object' or exists (
    select 1 from jsonb_object_keys(p_patch) k where k not in
    ('name','starts_at','physical_capacity','men_paid_cap','early_price_cents','late_price_cents','early_price_ends_at','pricing_mode','reservation_minutes','claim_hold_hours','sales_mode','sales_open_at','sales_close_at')
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
    ('name','starts_at','physical_capacity','men_paid_cap','early_price_cents','late_price_cents','early_price_ends_at','pricing_mode','reservation_minutes','claim_hold_hours','sales_mode','sales_open_at','sales_close_at')
  ) then raise exception 'INVALID_EVENT'; end if;
  perform public.validate_pricing_input(p_values);
  v := jsonb_populate_record(null::public.events,p_values);
  perform public.admin_validate_event(v);
  insert into public.events(name,starts_at,physical_capacity,men_paid_cap,ticket_price_cents,early_price_cents,late_price_cents,early_price_ends_at,pricing_mode,reservation_minutes,claim_hold_hours,sales_mode,sales_open_at,sales_close_at,is_active)
    values(trim(v.name),v.starts_at,v.physical_capacity,v.men_paid_cap,v.early_price_cents,v.early_price_cents,v.late_price_cents,v.early_price_ends_at,v.pricing_mode,v.reservation_minutes,v.claim_hold_hours,v.sales_mode,v.sales_open_at,v.sales_close_at,false)
    returning * into v;
  return to_jsonb(v);
end; $$;


revoke all on function public.event_pricing(public.events,timestamptz),public.read_event_pricing(uuid),
  public.validate_pricing_input(jsonb),public.create_reservation(uuid,text,text,text,public.ticket_category),
  public.admin_validate_event(public.events),public.admin_update_event(uuid,jsonb,uuid),public.admin_create_event(jsonb,uuid)
  from public,anon,authenticated;
grant execute on function public.read_event_pricing(uuid),public.create_reservation(uuid,text,text,text,public.ticket_category),
  public.admin_update_event(uuid,jsonb,uuid),public.admin_create_event(jsonb,uuid) to service_role;
commit;
