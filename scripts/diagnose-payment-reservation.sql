-- Read-only diagnostic for a disposable local classroom database.
-- Fill in the three NULL inputs below with UUIDs from synthetic rows only.
-- Does NOT call confirm/claim/recovery/delivery or modify any row.
-- Output contains no guest names/emails, QR hashes/tokens or account identifiers.
-- Reservation UUIDs are supplied as input but represented by labels in output.
begin transaction read only;
with inputs(affected_id, working_id, event_id) as (
  values (NULL::uuid, NULL::uuid, NULL::uuid)
), targets(label,id,expected_event_id) as (
  select 'affected',affected_id,event_id from inputs where affected_id is not null
  union all
  select 'working',working_id,null from inputs where working_id is not null
)
select t.label,now() as observed_at,
  r.id is not null as reservation_exists,
  case when t.label='affected' then r.event_id=t.expected_event_id end as matches_supplied_event,
  r.status,r.amount_cents,r.pricing_tier,r.category,
  r.created_at,r.reserved_until,r.claimed_at,r.paid_at,r.rejected_at,r.expired_at,r.checked_in_at,
  e.id is not null as event_exists,e.is_active as event_active,e.claim_hold_hours,
  r.claimed_at+make_interval(hours=>e.claim_hold_hours) as claim_expires_at,
  r.reserved_until>now() as reservation_hold_live,
  r.claimed_at+make_interval(hours=>e.claim_hold_hours)>now() as claim_hold_live,
  -- Prediction follows the supplied confirm_payment definition, NOT a live call.
  -- It cannot identify trigger/constraint failures or prove the deployed definition.
  case when r.id is null or e.id is null then 'RESERVATION_NOT_FOUND'
    when r.status='PAID' then 'ALREADY_PAID: inspect ticket delivery separately'
    when r.status<>'PAYMENT_CLAIMED' then 'PAYMENT_NOT_CLAIMED'
    when r.claimed_at is null or r.claimed_at+make_interval(hours=>e.claim_hold_hours)<=now() then 'RETURNS_EXPIRED'
    else 'ELIGIBLE_BY_SUPPLIED_RPC: inspect actual response/log if failure persists'
  end as expected_confirm_branch,
  r.confirmed_by is not null as has_legacy_confirmation_actor,
  r.confirmed_by_access_id is not null as has_access_confirmation_actor,
  r.qr_token_hash is not null as has_qr_hash,
  r.qr_created_at,r.ticket_sent_at,r.ticket_email_attempts,r.ticket_email_last_attempt_at,
  case when r.ticket_email_error is null then null
    when r.ticket_email_error in (
      'Demo ticket is being prepared.',
      'Demo ticket could not be issued. Use RETRY TICKET.',
      'Ticket signing configuration does not match the existing ticket. Restore the original signing secret.',
      'Ticket issuance result could not be saved. Use RETRY TICKET.',
      'Ticket issuance needs attention. Refresh and use RETRY TICKET.'
    ) then r.ticket_email_error else 'UNRECOGNIZED_ERROR_REDACTED' end as safe_delivery_error,
  r.ticket_email_error='Ticket email is being prepared.'
    and r.ticket_email_last_attempt_at+interval '2 minutes'>now() as delivery_lease_live,
  r.amount_cents>=0 as valid_ticket_amount,
  r.category::text in ('MEN','WOMEN') as valid_ticket_category,
  (r.email is not null and r.email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$') as email_syntax_valid,
  (select count(*) from public.reservations other where other.id<>r.id
    and other.event_id=r.event_id and lower(other.email)=lower(r.email)) as same_email_other_rows,
  (select count(*) from public.reservations other where other.id<>r.id
    and other.event_id=r.event_id and lower(other.email)=lower(r.email)
    and other.status in ('RESERVED','PAYMENT_CLAIMED','PAID')) as same_email_other_stored_active_rows,
  (select coalesce(jsonb_agg(jsonb_build_object(
    'previous_amount_cents',a.previous_amount_cents,'new_amount_cents',a.new_amount_cents,
    'adjusted_at',a.adjusted_at,'has_actor',a.adjusted_by_access_id is not null
  ) order by a.adjusted_at,a.id),'[]'::jsonb)
    from public.reservation_amount_adjustments a where a.reservation_id=r.id) as amount_adjustments
from targets t
left join public.reservations r on r.id=t.id
left join public.events e on e.id=r.event_id
order by t.label;
rollback;

-- Separately inspect the local RPC definition to compare it
-- with the supplied definition. Keep any raw logs/private diagnostics out of chat.
-- select pg_get_functiondef(to_regprocedure('public.confirm_payment(uuid)'));
