'use strict';
const {HttpError,jsonBody}=require('./http');
const {requireAdmin}=require('./admin-auth');
const {reviewInput}=require('./validation');
async function changeCategory(db,req){
  const admin=await requireAdmin(db,req);
  const body=jsonBody(req,['reservation_id','category']);
  const {reservation_id}=reviewInput({body:{reservation_id:body.reservation_id}});
  if(!['MEN','WOMEN'].includes(body.category))throw new HttpError(400,'INVALID_INPUT','Choose MEN or WOMEN.');
  const result=await db.rpc('admin_change_paid_category',{p_reservation_id:reservation_id,p_category:body.category,p_admin_id:admin.account_id});
  if(result.error){
    const errors={MEN_TICKETS_FULL:[409,'MEN tickets are full. The category was not changed.'],CATEGORY_NOT_EDITABLE:[409,'Only paid tickets that have not checked in can be edited. Refresh the dashboard.'],RESERVATION_NOT_FOUND:[404,'Reservation not found. Refresh the dashboard.'],FORBIDDEN:[403,'Only SUPER_ADMIN can change ticket categories.'],INVALID_CATEGORY:[400,'Choose MEN or WOMEN.']};
    const known=errors[result.error.message];
    if(known)throw new HttpError(known[0],result.error.message,known[1]);
    if(result.error.code==='PGRST202')throw new HttpError(503,'SETUP_REQUIRED','Category correction database setup is required.');
    throw new Error('Category could not be updated.');
  }
  return result.data;
}
module.exports={changeCategory};
