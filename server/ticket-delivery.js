'use strict';
const {HttpError} = require('./http');
const {deriveTicketToken,hashTicketToken,matchesTokenHash,generateQrPng} = require('./tickets');
const FIELDS = 'id,event_id,first_name,last_name,email,category,amount_cents,status,qr_token_hash,qr_created_at,ticket_sent_at,ticket_email_last_attempt_at,ticket_email_attempts,ticket_email_error,events(name)';
const SENDING = 'Demo ticket is being prepared.';
const FAILED = 'Demo ticket could not be issued. Use RETRY TICKET.';
const MISMATCH = 'Ticket signing configuration does not match the existing ticket. Restore the original signing secret.';
const UNSAVED = 'Ticket issuance result could not be saved. Use RETRY TICKET.';
const RECOVERY = 'Ticket issuance needs attention. Refresh and use RETRY TICKET.';
const LEASE_MS = 120000;
function checked(result) { if (result.error) throw new Error('Ticket record could not be updated.'); return result.data; }
function safeTicketError(value) { return value ? [SENDING,FAILED,MISMATCH,UNSAVED,RECOVERY].includes(value) ? value : RECOVERY : null; }
async function loadPaid(db,id) {
  const row = checked(await db.from('reservations').select(FIELDS).eq('id',id).maybeSingle());
  if (!row) throw new HttpError(404,'RESERVATION_NOT_FOUND','Reservation not found.');
  if (row.status !== 'PAID') throw new HttpError(409,'PAYMENT_NOT_CONFIRMED','Only paid reservations can receive a ticket.');
  return row;
}
async function recordConfirmation(db,id,accountId) {
  // Record the first authenticated admin; retries must not replace the audit actor.
  checked(await db.from('reservations').update({confirmed_by_access_id:accountId}).eq('id',id).eq('status','PAID').is('confirmed_by_access_id',null).is('confirmed_by',null));
}
function result(row, error = safeTicketError(row.ticket_email_error)) {
  return {ticket_email_sent:Boolean(row.ticket_sent_at),ticket_email_pending:error === SENDING,ticket_email_error:error};
}
async function deliverTicket(db,id,{resend = false, secret = process.env.DEMO_TICKET_SIGNING_SECRET, now = () => new Date(), generate = generateQrPng, send} = {}) {
  const row = await loadPaid(db,id);
  if (!resend && row.ticket_sent_at) return result(row,null);
  const attempts = row.ticket_email_attempts ?? 0;
  if (!Number.isSafeInteger(attempts) || attempts < 0) throw new Error('Invalid delivery counter.');
  const time = now();
  const inProgress = row.ticket_email_error === SENDING && Date.parse(row.ticket_email_last_attempt_at) + LEASE_MS > time.getTime();
  if (inProgress) return result(row,SENDING);
  // Automatic delivery is attempted once. Failed/uncertain attempts require an explicit resend.
  if (!resend && attempts > 0) return result(row,row.ticket_email_error === SENDING ? RECOVERY : safeTicketError(row.ticket_email_error) || RECOVERY);

  // Compare-and-set increments the counter atomically and elects one issuer.
  let query = db.from('reservations').update({ticket_email_attempts:attempts+1,ticket_email_last_attempt_at:time.toISOString(),ticket_email_error:SENDING}).eq('id',id).eq('status','PAID');
  query = row.ticket_email_attempts == null ? query.is('ticket_email_attempts',null) : query.eq('ticket_email_attempts',attempts);
  const acquired = checked(await query.select('id'));
  if (!acquired.length) return result(await loadPaid(db,id));
  const attemptUpdate = values => db.from('reservations').update(values).eq('id',id).eq('status','PAID').eq('ticket_email_attempts',attempts+1).eq('ticket_email_last_attempt_at',time.toISOString()).select('id');
  let error = FAILED, generated = false;
  try {
    const token = deriveTicketToken(row.id,row.event_id,secret);
    if (row.qr_token_hash && !matchesTokenHash(token,row.qr_token_hash)) { error = MISMATCH; throw new Error('Ticket hash mismatch.'); }
    const values = {};
    if (!row.qr_token_hash) values.qr_token_hash = hashTicketToken(token);
    if (!row.qr_created_at) values.qr_created_at = time.toISOString();
    if (Object.keys(values).length && !checked(await attemptUpdate(values)).length) throw new Error('Ticket attempt changed.');
    const png = await generate(token);
    // Tests can capture the generated ticket in memory.
    if (send) await send(row,png);
    generated = true;
    // Keep the existing schema. This timestamp records local demo issuance.
    if (!checked(await attemptUpdate({ticket_sent_at:now().toISOString(),ticket_email_error:null})).length) throw new Error('Ticket attempt changed.');
    return {ticket_email_sent:true,ticket_email_pending:false,ticket_email_error:null};
  } catch {
    // Never write payment status or persist raw errors or token material.
    if (generated) error = UNSAVED;
    try { checked(await attemptUpdate({ticket_email_error:error})); } catch {}
    return {ticket_email_sent:Boolean(row.ticket_sent_at),ticket_email_pending:false,ticket_email_error:error};
  }
}

async function issuedTicketQr(db,id,eventId,secret = process.env.DEMO_TICKET_SIGNING_SECRET) {
  const row = await loadPaid(db,id);
  if (row.event_id !== eventId || !row.ticket_sent_at) {
    throw new HttpError(404,'TICKET_NOT_FOUND','Issued demo ticket not found for the active event.');
  }
  const token = deriveTicketToken(row.id,row.event_id,secret);
  if (!matchesTokenHash(token,row.qr_token_hash)) throw new HttpError(409,'TICKET_HASH_MISMATCH',MISMATCH);
  return generateQrPng(token);
}
module.exports = {deliverTicket,recordConfirmation,safeTicketError,issuedTicketQr,RECOVERY};
