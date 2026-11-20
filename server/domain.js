'use strict';
// Retained qualitative thresholds. The current events schema has no threshold columns.
const FEW_TOTAL = 15, FEW_MEN = 7;
function claimDeadline(row, event) {
  return Date.parse(row.claimed_at) + event.claim_hold_hours * 3600000;
}
function effectiveStatus(row, event, now = Date.now()) {
  if (row.status === 'RESERVED' && !(Date.parse(row.reserved_until) > now)) return 'EXPIRED';
  if (row.status === 'PAYMENT_CLAIMED' && !(claimDeadline(row,event) > now)) return 'EXPIRED';
  return row.status;
}
function salesOpen(event, now = Date.now()) {
  if (!event.is_active) return false;
  if (event.sales_mode === 'OPEN') return true;
  if (event.sales_mode !== 'SCHEDULED') return false;
  // Match the supplied create_reservation RPC's inclusive closing boundary.
  return Date.parse(event.sales_open_at) <= now && (!event.sales_close_at || Date.parse(event.sales_close_at) >= now);
}
function publicState(event, rows, nonPayingCount, now = Date.now()) {
  const occupied = rows.filter(row => ['PAID','RESERVED','PAYMENT_CLAIMED'].includes(effectiveStatus(row,event,now)));
  const remaining = event.physical_capacity - nonPayingCount - occupied.length;
  const menRemaining = event.men_paid_cap - occupied.filter(row => row.category === 'MEN').length;
  const open = salesOpen(event,now);
  const status = (available, threshold) => !open || available <= 0 ? 'SOLD_OUT' : available <= threshold ? 'FEW_TICKETS_LEFT' : 'AVAILABLE';
  return {
    event_id:event.id, name:event.name, starts_at:event.starts_at,
    reservation_minutes:event.reservation_minutes,
    sales_status:open ? 'OPEN' : 'CLOSED',
    men_status:!open || remaining <= 0 || menRemaining <= 0 ? 'SOLD_OUT' : remaining <= FEW_TOTAL || menRemaining <= FEW_MEN ? 'FEW_TICKETS_LEFT' : 'AVAILABLE',
    women_status:status(remaining,FEW_TOTAL)
  };
}
function reservationView(row, event, now = Date.now()) {
  return {reservation_id:row.id, category:row.category, status:effectiveStatus(row,event,now), amount_cents:row.amount_cents,
    pricing_tier:row.pricing_tier ?? null,
    reserved_until:row.reserved_until, claimed_at:row.claimed_at,
    claim_expires_at:row.claimed_at ? new Date(claimDeadline(row,event)).toISOString() : null};
}
module.exports = {effectiveStatus, publicState, salesOpen, reservationView};
