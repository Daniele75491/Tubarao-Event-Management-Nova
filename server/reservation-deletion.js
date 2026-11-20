'use strict';
const {HttpError} = require('./http');
const {requireAdmin} = require('./admin-auth');
const {reviewInput} = require('./validation');
const STATUSES = ['RESERVED','REJECTED','EXPIRED'];
const TICKET_FIELDS = ['paid_at','checked_in_at','qr_token_hash','qr_created_at','ticket_sent_at'];
function canDeleteReservation(row) {
  return STATUSES.includes(row.status) && TICKET_FIELDS.every(field => row[field] === null);
}
async function deleteReservation(db,req) {
  await requireAdmin(db,req);
  const {reservation_id:id} = reviewInput(req);
  const result = await db.from('reservations').select(['id','status',...TICKET_FIELDS].join(',')).eq('id',id).maybeSingle();
  if (result.error) throw new Error('Reservation lookup failed.');
  if (!result.data) throw new HttpError(404,'RESERVATION_NOT_FOUND','Reservation not found. Refresh the dashboard.');
  const blocked = () => new HttpError(409,'RESERVATION_NOT_DELETABLE','This record cannot be deleted. Refresh and check its payment and ticket status.');
  if (!canDeleteReservation(result.data)) throw blocked();
  // One conditional DELETE, not an unconditional write following a stale read.
  // PostgreSQL rechecks these predicates after any concurrent row update.
  let query = db.from('reservations').delete().eq('id',id).eq('status',result.data.status);
  for (const field of TICKET_FIELDS) query = query.is(field,null);
  const deleted = await query.select('id');
  if (deleted.error) throw new Error('Reservation deletion failed.');
  if (deleted.data?.length !== 1 || deleted.data[0].id !== id) throw blocked();
  return {reservation_id:id,deleted:true};
}
async function deletePaidTicket(db,req) {
  await requireAdmin(db,req); // SUPER_ADMIN only; never trust a browser role.
  const {reservation_id:id} = reviewInput(req);
  // PostgreSQL locks the target row and rechecks the predicate if a concurrent
  // check-in updated it. Deletion first makes subsequent check-in return INVALID.
  const result = await db.from('reservations').delete().eq('id',id)
    .eq('status','PAID').is('checked_in_at',null).select('id');
  if (result.error) throw new Error('Paid ticket deletion failed.');
  if (result.data?.length !== 1 || result.data[0].id !== id) {
    throw new HttpError(409,'PAID_TICKET_NOT_DELETABLE','This ticket is no longer eligible for deletion. Refresh the dashboard.');
  }
  return {reservation_id:id,deleted:true};
}
module.exports = {canDeleteReservation,deleteReservation,deletePaidTicket};
