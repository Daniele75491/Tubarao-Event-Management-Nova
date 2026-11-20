'use strict';
const {HttpError,jsonBody}=require('./http');
const {requireAdmin}=require('./admin-auth');
const {reviewInput}=require('./validation');
async function adjustAmount(db,req){
  const admin=await requireAdmin(db,req);
  const body=jsonBody(req,['reservation_id','amount_cents']);
  const {reservation_id}=reviewInput({body:{reservation_id:body.reservation_id}});
  if(!Number.isInteger(body.amount_cents)||body.amount_cents<1||body.amount_cents>100000)throw new HttpError(400,'INVALID_INPUT','Enter an amount between €0.01 and €1,000.00.');
  const result=await db.rpc('admin_adjust_reservation_amount',{p_reservation_id:reservation_id,p_amount_cents:body.amount_cents,p_admin_id:admin.account_id});
  if(result.error){
    const errors={AMOUNT_NOT_EDITABLE:[409,'Only reserved, payment-claimed or paid reservations can be adjusted. Refresh the dashboard.'],RESERVATION_NOT_FOUND:[404,'Reservation not found. Refresh the dashboard.'],FORBIDDEN:[403,'Only SUPER_ADMIN can adjust amounts.'],INVALID_AMOUNT:[400,'Enter an amount between €0.01 and €1,000.00.']};
    const known=errors[result.error.message];if(known)throw new HttpError(known[0],result.error.message,known[1]);
    if(result.error.code==='PGRST202')throw new HttpError(503,'SETUP_REQUIRED','Amount adjustment database setup is required.');
    throw new Error('Amount could not be updated.');
  }
  return result.data;
}
module.exports={adjustAmount};
