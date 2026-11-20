'use strict';
const {HttpError} = require('./http');
const {requireAdmin} = require('./admin-auth');
const {canDeleteReservation} = require('./reservation-deletion');
const {effectiveStatus, publicState, reservationView} = require('./domain');
const {reservationInput, claimInput, reviewInput, reservationId} = require('./validation');
const kpis = require('../admin-kpis');
const {deliverTicket,recordConfirmation,safeTicketError,issuedTicketQr,RECOVERY} = require('./ticket-delivery');
const EVENT_FIELDS = 'id,name,starts_at,physical_capacity,men_paid_cap,early_price_cents,late_price_cents,early_price_ends_at,pricing_mode,show_pricing_countdown,show_late_price_before_start,reservation_minutes,claim_hold_hours,sales_mode,sales_open_at,sales_close_at,is_active,created_at';
const RESERVATION_FIELDS = 'id,event_id,first_name,last_name,email,category,amount_cents,pricing_tier,status,reserved_until,created_at,claimed_at,paid_at,rejected_at,checked_in_at,qr_created_at,ticket_sent_at,ticket_email_attempts,ticket_email_error';
const ERRORS = {
  EVENT_NOT_FOUND:[404,'No active event is available.'], EVENT_SOLD_OUT:[409,'This event is sold out.'],
  MEN_SOLD_OUT:[409,'Men tickets are sold out.'], SALES_CLOSED:[409,'Ticket sales are closed.'],
  ACTIVE_RESERVATION_EXISTS:[409,'This email already has a reservation or paid ticket. Return to your existing checkout.'],
  RESERVATION_NOT_FOUND:[404,'Reservation not found. Check your details.'],
  INVALID_RESERVATION_STATUS:[409,'This reservation can no longer be claimed.'],
  PAYMENT_NOT_CLAIMED:[409,'This reservation is not awaiting payment verification.']
};
function dbResult(result) {
  if (result.error) {
    if (result.error.code === '23505' && result.error.message?.includes('reservations_one_active_email_per_event')) {
      throw new HttpError(409,'ACTIVE_RESERVATION_EXISTS',ERRORS.ACTIVE_RESERVATION_EXISTS[1]);
    }
    const code = Object.keys(ERRORS).find(key => result.error.message === key);
    if (code) throw new HttpError(ERRORS[code][0],code,ERRORS[code][1]);
    throw new Error('Database request failed.');
  }
  return result.data;
}
async function currentEvent(db) {
  const query = () => db.from('events').select(EVENT_FIELDS).eq('is_active',true).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(1);
  let rows = dbResult(await query().in('sales_mode',['OPEN','SCHEDULED']));
  if (!rows.length) rows = dbResult(await query());
  if (!rows.length) throw new HttpError(404,'EVENT_NOT_FOUND',ERRORS.EVENT_NOT_FOUND[1]);
  return rows[0];
}
async function allRows(db, table, fields, eventId) {
  const rows = [];
  for (let from = 0; ; from += 500) {
    const page = dbResult(await db.from(table).select(fields).eq('event_id',eventId).order('id').range(from,from+499));
    rows.push(...page);
    if (page.length < 500) return rows;
  }
}
async function eventState(db) {
  const event = await currentEvent(db);
  const [rows, countResult] = await Promise.all([
    allRows(db,'reservations','id,category,status,reserved_until,claimed_at',event.id),
    db.from('non_paying_attendees').select('id',{count:'exact',head:true}).eq('event_id',event.id)
  ]);
  dbResult(countResult);
  if (!Number.isInteger(countResult.count)) throw new Error('Count unavailable.');
  const pricing = await readPricing(db,event.id);
  return {...publicState(event,rows,countResult.count,Date.parse(pricing.server_now)),
    server_now:pricing.server_now, pricing:{...pricing,
      show_countdown:event.show_pricing_countdown===true,
      show_late_price:event.show_late_price_before_start===true,
      next_price_cents:event.show_late_price_before_start===true?pricing.next_price_cents:null},
    ticket_price_cents:pricing.current_price_cents}; // Response alias for older display clients, never the legacy DB field.
}
async function readPricing(db,eventId) {
  const pricing = dbResult(await db.rpc('read_event_pricing',{p_event_id:eventId}));
  if (!['EARLY','LATE'].includes(pricing?.phase) || !Number.isInteger(pricing.current_price_cents)
    || pricing.current_price_cents<1 || !Number.isFinite(Date.parse(pricing.server_now))) throw new Error('Pricing unavailable.');
  return {phase:pricing.phase,current_price_cents:pricing.current_price_cents,
    next_price_cents:pricing.next_price_cents,early_price_ends_at:pricing.early_price_ends_at,server_now:pricing.server_now};
}
async function reserve(db, req) {
  const input = reservationInput(req), event = await currentEvent(db);
  const resume = async () => {
    const row = dbResult(await db.from('reservations').select('id,first_name,last_name,email,category,status,amount_cents,pricing_tier,reserved_until,claimed_at')
      .eq('event_id',event.id).eq('email',input.email).in('status',['RESERVED','PAYMENT_CLAIMED','PAID']).maybeSingle());
    if (!row || !['RESERVED','PAYMENT_CLAIMED','PAID'].includes(effectiveStatus(row,event))) return null;
    const normalized = value => value.normalize('NFKC').trim().replace(/\s+/gu,' ').toLowerCase();
    if (normalized(row.email) !== normalized(input.email) || normalized(row.first_name) !== normalized(input.first_name)
      || normalized(row.last_name) !== normalized(input.last_name) || row.category !== input.category) {
      throw new HttpError(409,'ACTIVE_RESERVATION_EXISTS',ERRORS.ACTIVE_RESERVATION_EXISTS[1]);
    }
    return reservationView(row,event);
  };
  const existing = await resume();
  if (existing) return existing;
  let data;
  try {
    data = dbResult(await db.rpc('create_reservation',{
      p_event_id:event.id, p_first_name:input.first_name,p_last_name:input.last_name,p_email:input.email,p_category:input.category
    }));
  } catch (error) {
    // A concurrent submit may have created this same customer's hold after our read.
    if (error.code === 'ACTIVE_RESERVATION_EXISTS') { const raced = await resume(); if (raced) return raced; }
    throw error;
  }
  return {reservation_id:data.reservation_id,status:data.status,amount_cents:data.amount_cents,pricing_tier:data.pricing_tier ?? null,reserved_until:data.reserved_until};
}
async function ownedReservation(db, input) {
  const row = dbResult(await db.from('reservations').select('id,event_id,category,status,amount_cents,pricing_tier,reserved_until,claimed_at').eq('id',input.reservation_id).eq('email',input.email).maybeSingle());
  if (!row) throw new HttpError(404,'RESERVATION_NOT_FOUND',ERRORS.RESERVATION_NOT_FOUND[1]);
  const event = dbResult(await db.from('events').select('claim_hold_hours').eq('id',row.event_id).single());
  return reservationView(row,event);
}
async function claim(db, req) {
  const input = claimInput(req);
  dbResult(await db.rpc('claim_payment',{p_reservation_id:input.reservation_id,p_email:input.email}));
  // The existing RPC returns PAYMENT_CLAIMED on retries even after its hold elapsed.
  // Read the authoritative timestamps to report its effective expiry consistently.
  return ownedReservation(db,input);
}
async function dashboard(db, req) {
  const admin = await requireAdmin(db,req);
  let event;
  try { event = await currentEvent(db); }
  catch(error) { if(error.code!=='EVENT_NOT_FOUND')throw error; return {admin,event:null,reservations:[],non_paying_attendees:[],kpis:kpis.calculate([],[])}; }
  const [rows, nonPaying] = await Promise.all([
    allRows(db,'reservations',RESERVATION_FIELDS+',qr_token_hash',event.id),
    allRows(db,'non_paying_attendees','id,first_name,last_name,email,category,checked_in_at',event.id)
  ]);
  const reservations = rows.map(({qr_token_hash,...row}) => ({...row,can_delete:canDeleteReservation({...row,qr_token_hash}),status:effectiveStatus(row,event),ticket_email_error:safeTicketError(row.ticket_email_error)}));
  const summary = kpis.calculate(reservations.map(row => ({...row,price:row.amount_cents/100})),nonPaying);
  return {admin,event:{...event,pricing:await readPricing(db,event.id)},reservations,non_paying_attendees:nonPaying,kpis:summary};
}
async function review(db, req, rpc, deliveryOptions) {
  const admin = await requireAdmin(db,req);
  const input = reviewInput(req);
  const external = rpc === 'confirm_external_payment';
  const result = await db.rpc(rpc,{p_reservation_id:input.reservation_id,...(external ? {p_admin_id:admin.account_id} : {})});
  if (external && result.error?.code === 'PGRST202') throw new HttpError(503,'SETUP_REQUIRED','Payment recovery is not configured yet. Contact the organizers.');
  if (external && result.error?.message === 'FORBIDDEN') throw new HttpError(403,'FORBIDDEN','Super admin access is required.');
  if (external && result.error?.message === 'EVENT_CHANGED') throw new HttpError(409,'EVENT_CHANGED','The active event has changed. Refresh the dashboard.');
  const data = dbResult(result);
  if ((rpc === 'confirm_payment' || external) && data.status === 'PAID') {
    try {
      await recordConfirmation(db,input.reservation_id,admin.account_id);
      return {reservation_id:data.reservation_id,status:'PAID',...await deliverTicket(db,input.reservation_id,deliveryOptions)};
    } catch {
      // The RPC already committed PAID. Audit/delivery trouble must not report payment failure.
      return {reservation_id:data.reservation_id,status:'PAID',ticket_email_sent:false,ticket_email_error:RECOVERY};
    }
  }
  return {reservation_id:data.reservation_id,status:data.status};
}
async function resendTicket(db, req, deliveryOptions) {
  await requireAdmin(db,req);
  const input = reviewInput(req);
  return {reservation_id:input.reservation_id,status:'PAID',...await deliverTicket(db,input.reservation_id,{...deliveryOptions,resend:true})};
}
async function downloadTicketQr(db, req) {
  await requireAdmin(db,req);
  const id = reservationId(req.query?.reservation_id);
  const event = await currentEvent(db);
  return issuedTicketQr(db,id,event.id);
}
module.exports = {readPricing,dbResult,currentEvent,requireAdmin,eventState,reserve,claim,dashboard,review,resendTicket,downloadTicketQr,ownedReservation,allRows};
