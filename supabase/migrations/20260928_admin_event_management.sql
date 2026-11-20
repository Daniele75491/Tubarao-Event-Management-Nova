-- Apply manually in Supabase before deploying the event-management routes.
-- Additive migration: no existing table, reservation/payment RPC or RLS changes.
begin;

create or replace function public.admin_event_role(p_admin_id uuid, p_super boolean default false)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.admin_profiles where user_id=p_admin_id
    and (role='SUPER_ADMIN' or (not p_super and role='ADMIN'))) then
    raise exception 'FORBIDDEN';
  end if;
end; $$;

create or replace function public.admin_validate_event(p_event public.events)
returns void language plpgsql set search_path = public as $$
begin
  if p_event.name is null or length(trim(p_event.name)) not between 1 and 120
    or p_event.physical_capacity is null or p_event.physical_capacity<=0
    or p_event.men_paid_cap is null or p_event.men_paid_cap<0 or p_event.men_paid_cap>p_event.physical_capacity
    or p_event.ticket_price_cents is null or p_event.ticket_price_cents<0
    or p_event.reservation_minutes is null or p_event.reservation_minutes<=0
    or p_event.claim_hold_hours is null or p_event.claim_hold_hours<=0
    or p_event.sales_mode is null
    or (p_event.sales_mode='SCHEDULED' and p_event.sales_open_at is null)
    or (p_event.sales_open_at is not null and p_event.sales_close_at is not null and p_event.sales_close_at<=p_event.sales_open_at)
  then raise exception 'INVALID_EVENT'; end if;
end; $$;

-- All admin event mutations use this global transaction lock. Capacity mutations
-- then take the SAME per-event advisory lock as create_reservation, then the event
-- row, then the reservations table lock. This also serializes claim/confirm writes
-- which use reservation-level locks instead of create_reservation's event lock.
create or replace function public.admin_locked_event(p_event_id uuid)
returns public.events language plpgsql security definer set search_path = public as $$
declare v public.events; v_current uuid;
begin
  perform pg_advisory_xact_lock(178231, 1);
  perform pg_advisory_xact_lock(hashtext(p_event_id::text));
  select id into v_current from public.events where is_active=true
    order by (sales_mode in ('OPEN','SCHEDULED')) desc, created_at desc, id desc limit 1;
  if v_current is distinct from p_event_id then raise exception 'EVENT_CHANGED'; end if;
  select * into v from public.events where id=p_event_id for update;
  if not found then raise exception 'EVENT_NOT_FOUND'; end if;
  lock table public.reservations in share row exclusive mode;
  lock table public.non_paying_attendees in share row exclusive mode;
  return v;
end; $$;

create or replace function public.admin_update_event(p_event_id uuid,p_patch jsonb,p_admin_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.events; v_next public.events; v_total bigint; v_men bigint; v_guests bigint;
begin
  perform public.admin_event_role(p_admin_id);
  v := public.admin_locked_event(p_event_id);
  if p_patch is null or jsonb_typeof(p_patch)<>'object' or exists (
    select 1 from jsonb_object_keys(p_patch) k where k not in
    ('name','starts_at','physical_capacity','men_paid_cap','ticket_price_cents','reservation_minutes','claim_hold_hours','sales_mode','sales_open_at','sales_close_at')
  ) then raise exception 'INVALID_EVENT'; end if;
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
    ticket_price_cents=v_next.ticket_price_cents,reservation_minutes=v_next.reservation_minutes,
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
    ('name','starts_at','physical_capacity','men_paid_cap','ticket_price_cents','reservation_minutes','claim_hold_hours','sales_mode','sales_open_at','sales_close_at')
  ) then raise exception 'INVALID_EVENT'; end if;
  v := jsonb_populate_record(null::public.events,p_values);
  perform public.admin_validate_event(v);
  insert into public.events(name,starts_at,physical_capacity,men_paid_cap,ticket_price_cents,reservation_minutes,claim_hold_hours,sales_mode,sales_open_at,sales_close_at,is_active)
    values(trim(v.name),v.starts_at,v.physical_capacity,v.men_paid_cap,v.ticket_price_cents,v.reservation_minutes,v.claim_hold_hours,v.sales_mode,v.sales_open_at,v.sales_close_at,false)
    returning * into v;
  return to_jsonb(v);
end; $$;

create or replace function public.admin_activate_event(p_event_id uuid,p_admin_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.events;
begin
  perform public.admin_event_role(p_admin_id,true);
  perform pg_advisory_xact_lock(178231,1);
  lock table public.events in share row exclusive mode;
  select * into v from public.events where id=p_event_id;
  if not found then raise exception 'EVENT_NOT_FOUND'; end if;
  update public.events set is_active=false,updated_at=now() where is_active and id<>p_event_id;
  update public.events set is_active=true,updated_at=now() where id=p_event_id returning * into v;
  return to_jsonb(v);
end; $$;

create or replace function public.admin_add_non_paying(p_event_id uuid,p_values jsonb,p_admin_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.events; v_total bigint; v_guests bigint; a public.non_paying_attendees;
begin
  perform public.admin_event_role(p_admin_id);
  v := public.admin_locked_event(p_event_id);
  if p_values is null or jsonb_typeof(p_values)<>'object' or exists
    (select 1 from jsonb_object_keys(p_values) k where k not in ('first_name','last_name','email','category'))
    then raise exception 'INVALID_EVENT'; end if;
  a := jsonb_populate_record(null::public.non_paying_attendees,p_values);
  if a.first_name is null or length(trim(a.first_name)) not between 1 and 100
    or a.last_name is null or length(trim(a.last_name)) not between 1 and 100 or a.category is null
    then raise exception 'INVALID_EVENT'; end if;
  select count(*) into v_total from public.reservations where event_id=v.id and
    (status='PAID' or (status='RESERVED' and reserved_until>now())
    or (status='PAYMENT_CLAIMED' and claimed_at+make_interval(hours=>v.claim_hold_hours)>now()));
  select count(*) into v_guests from public.non_paying_attendees where event_id=v.id;
  if v_total+v_guests>=v.physical_capacity then raise exception 'EVENT_FULL'; end if;
  insert into public.non_paying_attendees(event_id,first_name,last_name,email,category)
    values(v.id,trim(a.first_name),trim(a.last_name),nullif(lower(trim(a.email)),''),a.category) returning * into a;
  return to_jsonb(a);
end; $$;

create or replace function public.admin_remove_non_paying(p_event_id uuid,p_attendee_id uuid,p_admin_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_event_role(p_admin_id);
  perform public.admin_locked_event(p_event_id);
  delete from public.non_paying_attendees where id=p_attendee_id and event_id=p_event_id;
  if not found then raise exception 'ATTENDEE_NOT_FOUND'; end if;
  return jsonb_build_object('removed',true);
end; $$;

revoke all on function public.admin_event_role(uuid,boolean),public.admin_validate_event(public.events),public.admin_locked_event(uuid),public.admin_update_event(uuid,jsonb,uuid),public.admin_create_event(jsonb,uuid),public.admin_activate_event(uuid,uuid),public.admin_add_non_paying(uuid,jsonb,uuid),public.admin_remove_non_paying(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.admin_update_event(uuid,jsonb,uuid),public.admin_create_event(jsonb,uuid),public.admin_activate_event(uuid,uuid),public.admin_add_non_paying(uuid,jsonb,uuid),public.admin_remove_non_paying(uuid,uuid,uuid) to service_role;
commit;
