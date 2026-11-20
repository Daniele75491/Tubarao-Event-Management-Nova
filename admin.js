'use strict';
const $ = id => document.getElementById(id);
let dataset = null, loading = false, reviewing = false, generation = 0;
let downloadingGuestList = false;
function hideDashboard() {
  $('delete-paid-dialog').close?.();
  $('category-dialog').close?.();
  $('amount-dialog').close?.();
  $('category-message').textContent='';
  window.TubaraoManagement?.reset();
  dataset = null; $('dashboard').hidden = true; $('login-panel').hidden = false;
  $('backup-message').hidden=true; $('backup-message').textContent=''; $('download-backup').disabled=true;
  $('guest-list-message').hidden=true; $('guest-list-message').textContent=''; $('download-guest-list').disabled=true;
  ['payment-claims','completed-payments','guests','non-paying-list','settings'].forEach(id => $(id).replaceChildren());
  $('completed-panel').open = false; $('completed-count').textContent = '0';
  document.querySelectorAll('.metric .v,.metric .s').forEach(node => node.textContent = '');
}
async function adminRequest(path, body, options = {}) {
  try { return await Tubarao.request(path,{body,...options,timeout:/^\/api\/admin\/payments\?action=(confirm-payment|confirm-external-payment|resend-ticket)$/.test(path) ? 60000 : 15000}); }
  catch(error) {
    if ([401,403].includes(error.status)) {
      generation++; hideDashboard(); $('auth-message').hidden=false; $('auth-message').textContent=error.message;
      if(error.status===403) { const identity=await Tubarao.request('/api/admin/auth'); if(identity.role==='ADMIN')location.replace('/checkin.html'); }
    }
    throw error;
  }
}
async function showIdentity(identity) {
  if(!identity.authenticated){hideDashboard();$('auth-message').hidden=true;return;}
  if(identity.role==='ADMIN'){hideDashboard();location.replace('/checkin.html');return;}
  if(identity.role!=='SUPER_ADMIN'){hideDashboard();return;}
  $('logout').hidden=false; await refreshDashboard();
}
async function refreshDashboard() {
  if (loading || reviewing) return;
  loading = true; const current = generation;
  paymentButtons().forEach(button => button.disabled = true);
  try {
    const data = await adminRequest('/api/admin/dashboard');
    if (current !== generation) return;
    dataset = data; renderDashboard();
    $('login-panel').hidden = true; $('dashboard').hidden = false; $('logout').hidden = false;
    $('auth-message').hidden = true;
  } catch (error) {
    if (current !== generation) return;
    hideDashboard(); $('auth-message').hidden = false; $('auth-message').textContent = error.message;
  } finally { loading = false; renderPaidAttendees(); }
}
function renderPaidAttendees() {
  if (!dataset) return;
  const all = dataset.reservations.filter(row => row.status === 'PAID').map(row => ({...row,first:row.first_name,last:row.last_name,cat:row.category.toLowerCase(),checkedIn:Boolean(row.checked_in_at)}));
  const selected = TubaraoAttendees.select(all,{first:$('filter-first').value,last:$('filter-last').value,email:$('filter-email').value,category:$('filter-category').value,status:$('filter-status').value,sort:$('attendee-sort').value});
  $('paid-results').textContent = selected.length + ' of ' + all.length + ' paid attendees';
  $('guests').replaceChildren();
  selected.forEach(person => {
    const row = appendRow($('guests'),[person.first_name,person.last_name,person.email,person.category,TubaraoAttendees.status(person),person.ticket_sent_at ? 'TICKET ISSUED' : 'TICKET NOT ISSUED']);
    if(dataset.admin.role==='SUPER_ADMIN'&&person.checked_in_at===null){
      const button=document.createElement('button');button.type='button';button.className='category-change';button.textContent='CHANGE';button.disabled=reviewing||loading;
      button.setAttribute('aria-label','Change category for '+person.first_name+' '+person.last_name);
      button.onclick=()=>editCategory(person.id);row.children[3].appendChild(button);
    }
    row.children[2].className = 'attendee-email';
    ['First name','Last name','Email','Category','Status','Ticket'].forEach((label,i) => row.children[i].setAttribute('data-label',label));
  });
  if (!selected.length) emptyRow($('guests'),6,all.length ? 'No attendees match these filters.' : 'NO PAYING ATTENDEES YET');
}

function editCategory(id){
  if(reviewing||loading||dataset?.admin.role!=='SUPER_ADMIN')return;
  const person=dataset.reservations.find(row=>row.id===id);
  if(!person||person.status!=='PAID'||person.checked_in_at!==null)return;
  const dialog=$('category-dialog');if(dialog.open)return;
  $('category-guest').textContent=person.first_name+' '+person.last_name+' · '+person.email;
  $('category-value').value=person.category;$('category-error').textContent='';
  $('category-save').disabled=false;$('category-save').textContent='SAVE';
  $('category-cancel').onclick=()=>{if(!reviewing)dialog.close();};
  $('category-form').onsubmit=async event=>{
    event.preventDefault();
    if(reviewing||loading||dataset?.admin.role!=='SUPER_ADMIN')return;
    const category=$('category-value').value;
    if(!['MEN','WOMEN'].includes(category))return;
    if(!dataset.reservations.some(row=>row.id===id&&row.status==='PAID'&&row.checked_in_at===null))return;
    if(category===person.category){dialog.close();return;}
    reviewing=true;const current=generation;
    $('category-save').disabled=true;$('category-save').textContent='SAVING…';$('category-error').textContent='';
    try{
      const result=await adminRequest('/api/admin/payments?action=change-category',{reservation_id:id,category});
      if(current!==generation)return;
      if(result.reservation_id!==id||result.category!==category)throw new Error('Category update could not be verified. Refresh the dashboard.');
      const row=dataset.reservations.find(row=>row.id===id);if(row)row.category=result.category;
      renderDashboard();dialog.close();$('category-message').textContent='CATEGORY UPDATED. The ticket QR remains valid.';
    }catch(error){if(current===generation)$('category-error').textContent=error.message;}
    finally{
      reviewing=false;
      if(current===generation){$('category-save').disabled=false;$('category-save').textContent='SAVE';await refreshDashboard();}
    }
  };
  dialog.showModal();
}

function appendRow(body, values) {
  const row = document.createElement('tr');
  values.forEach(value => { const cell = document.createElement('td'); cell.textContent = value ?? '—'; row.appendChild(cell); });
  body.appendChild(row); return row;
}
function emptyRow(body, span, text) { const row = appendRow(body,[text]); row.firstChild.colSpan = span; }
function paymentButtons() { return [...document.querySelectorAll('#payment-claims button'),...document.querySelectorAll('#completed-payments button')]; }
function actionButton(actions,route,label,reservation) {
  const button = document.createElement('button'); button.type = 'button'; button.className = 'btn secondary'; button.textContent = label;
  if(route==='delete-paid-ticket')button.classList.add('danger');
  button.setAttribute('aria-label',label + ' — ' + reservation.first_name + ' ' + reservation.last_name);
  button.onclick = () => review(route,reservation.id,button); actions.appendChild(button);
}

const adjustableStatuses=['RESERVED','PAYMENT_CLAIMED','PAID'];
function amountButton(container,reservation){
  if(dataset.admin.role!=='SUPER_ADMIN'||!adjustableStatuses.includes(reservation.status))return;
  const button=document.createElement('button');button.type='button';button.className='amount-adjust';button.textContent='ADJUST AMOUNT';
  button.setAttribute('aria-label','Adjust amount for '+reservation.first_name+' '+reservation.last_name);
  button.onclick=()=>editAmount(reservation.id);container.appendChild(button);
}
function amountToCents(raw){
  if(!/^(?:0|[1-9]\d{0,3})(?:\.\d{1,2})?$/.test(raw))throw new Error('Enter an amount with up to two decimal places.');
  const [whole,fraction='']=raw.split('.'),cents=Number(whole)*100+Number(fraction.padEnd(2,'0'));
  if(cents<1||cents>100000)throw new Error('Enter an amount between €0.01 and €1,000.00.');
  return cents;
}
function editAmount(id){
  if(reviewing||loading||dataset?.admin.role!=='SUPER_ADMIN')return;
  const person=dataset.reservations.find(row=>row.id===id);
  if(!person||!adjustableStatuses.includes(person.status))return;
  const dialog=$('amount-dialog');if(dialog.open)return;
  $('amount-guest').textContent=person.first_name+' '+person.last_name+' · '+person.email;
  $('amount-current').textContent=Tubarao.euro(person.amount_cents);$('amount-value').value=(person.amount_cents/100).toFixed(2);$('amount-error').textContent='';
  $('amount-save').disabled=false;$('amount-save').textContent='SAVE AMOUNT';
  $('amount-cancel').onclick=()=>{if(!reviewing)dialog.close();};
  $('amount-form').onsubmit=async event=>{
    event.preventDefault();
    if(reviewing||loading||dataset?.admin.role!=='SUPER_ADMIN')return;
    if(!dataset.reservations.some(row=>row.id===id&&adjustableStatuses.includes(row.status)))return;
    let amount;try{amount=amountToCents($('amount-value').value.trim());}catch(error){$('amount-error').textContent=error.message;return;}
    reviewing=true;const current=generation;
    $('amount-save').disabled=true;$('amount-save').textContent='SAVING…';$('amount-error').textContent='';
    try{
      const result=await adminRequest('/api/admin/payments?action=adjust-amount',{reservation_id:id,amount_cents:amount});
      if(current!==generation)return;
      if(result.reservation_id!==id||result.amount_cents!==amount)throw new Error('Amount update could not be verified. Refresh the dashboard.');
      const row=dataset.reservations.find(row=>row.id===id);if(row)row.amount_cents=result.amount_cents;
      renderDashboard();dialog.close();$('verification-message').hidden=false;$('verification-message').textContent=result.changed?'AMOUNT ADJUSTED. No money was sent, charged or refunded.':'AMOUNT UNCHANGED.';
    }catch(error){if(current===generation)$('amount-error').textContent=error.message;}
    finally{reviewing=false;if(current===generation){$('amount-save').disabled=false;$('amount-save').textContent='SAVE AMOUNT';await refreshDashboard();}}
  };
  dialog.showModal();
}

function renderPayments(reservations) {
  const completed = reservations.filter(row => row.status === 'PAID' && row.ticket_sent_at != null)
    .sort((a,b) => Date.parse(b.ticket_sent_at)-Date.parse(a.ticket_sent_at) || a.id.localeCompare(b.id));
  const pending = reservations.filter(row => !(row.status === 'PAID' && row.ticket_sent_at != null))
    .sort((a,b) => Number(b.status === 'PAYMENT_CLAIMED')-Number(a.status === 'PAYMENT_CLAIMED') || b.created_at.localeCompare(a.created_at));
  const list = $('completed-payments'), scroll = list.scrollTop;
  list.replaceChildren(); $('completed-count').textContent = String(completed.length);
  completed.forEach(reservation => {
    const item = document.createElement('li');
    const name = document.createElement('strong'); name.textContent = reservation.first_name + ' ' + reservation.last_name; item.appendChild(name);
    const info = document.createElement('p'); info.textContent = reservation.category + ' · ' + Tubarao.euro(reservation.amount_cents) + ' · PAID / TICKET ISSUED'; item.appendChild(info); amountButton(info,reservation);
    const time = document.createElement('p'); time.className = 'subtle'; time.textContent = new Date(reservation.ticket_sent_at).toLocaleString(); item.appendChild(time);
    if (reservation.ticket_email_error) { const error = document.createElement('p'); error.className = 'subtle'; error.textContent = reservation.ticket_email_error; item.appendChild(error); }
    if (dataset.admin.role === 'SUPER_ADMIN') {
      const qr = document.createElement('a');
      qr.className = 'btn secondary';
      qr.textContent = 'DOWNLOAD DEMO QR';
      qr.href = '/api/admin/payments?action=ticket-qr&reservation_id=' + encodeURIComponent(reservation.id);
      item.appendChild(qr);
      actionButton(item,'resend-ticket','RETRY TICKET',reservation);
    }
    if(dataset.admin.role==='SUPER_ADMIN' && reservation.checked_in_at===null)actionButton(item,'delete-paid-ticket','DELETE PAID TICKET',reservation);
    list.appendChild(item);
  });
  if (!completed.length) { const item = document.createElement('li'); item.textContent = 'NO TICKETS ISSUED YET'; list.appendChild(item); }
  list.scrollTop = scroll;
  $('payment-claims').replaceChildren();
  pending.forEach(reservation => {
    const row = appendRow($('payment-claims'),[reservation.first_name,reservation.last_name,reservation.email,reservation.category,Tubarao.euro(reservation.amount_cents),reservation.status.replaceAll('_',' '),new Date(reservation.created_at).toLocaleString() + (reservation.claimed_at ? ' / ' + new Date(reservation.claimed_at).toLocaleString() : '')]);
    amountButton(row.children[4],reservation);
    const actions = document.createElement('td'); row.appendChild(actions);
    ['First name','Last name','Email','Category','Expected amount','Status','Reserved / Claimed','Actions'].forEach((label,i) => row.children[i].setAttribute('data-label',label));
    if (dataset.admin.role !== 'SUPER_ADMIN') return;
    if (reservation.status === 'PAID') {
      const status = document.createElement('span'); status.className = 'attendee-status'; status.textContent = 'TICKET NOT ISSUED'; actions.appendChild(status);
      if (reservation.ticket_email_error) { const error = document.createElement('p'); error.className = 'subtle admin-help'; error.textContent = reservation.ticket_email_error; actions.appendChild(error); }
      actionButton(actions,'resend-ticket','RETRY TICKET',reservation);
      if(reservation.checked_in_at===null)actionButton(actions,'delete-paid-ticket','DELETE PAID TICKET',reservation);
    } else {
      if (['RESERVED','EXPIRED'].includes(reservation.status)) actionButton(actions,'confirm-external-payment','CONFIRM PAID',reservation);
      if (reservation.status === 'PAYMENT_CLAIMED') {
        actionButton(actions,'confirm-payment','CONFIRM PAID',reservation);
        actionButton(actions,'reject-payment','REJECT',reservation);
      }
      if (reservation.can_delete === true && ['RESERVED','REJECTED','EXPIRED'].includes(reservation.status)) actionButton(actions,'delete-record','DELETE RECORD',reservation);
    }
  });
  if (!pending.length) emptyRow($('payment-claims'),8,'NO PAYMENTS TO REVIEW');
}
function renderDashboard() {
  const scrollY = window.scrollY;
  const {reservations,non_paying_attendees:nonPaying} = dataset;
  const event = dataset.event || {name:"No active event",sales_mode:"CLOSED"};
  $('download-backup').disabled = !dataset.event;
  $('download-guest-list').disabled = downloadingGuestList || !dataset.event;
  $('admin-name').textContent = event.name;
  $('sale-status').textContent = event.sales_mode;
  $('manual-sales-label').textContent = event.sales_mode;
  TubaraoKPIs.render(document,reservations.map(row => ({...row,price:row.amount_cents/100})),nonPaying,value => Tubarao.euro(Math.round(value*100)));
  renderPayments(reservations);
  renderPaidAttendees();
  $('non-paying-count').textContent = nonPaying.length + ' non-paying attendees';
  window.TubaraoManagement?.render(dataset);
  if (Number.isFinite(scrollY)) window.scrollTo?.(0,scrollY);
}
async function review(route, reservationId, button, confirmedPaidDelete=false) {
  if (reviewing || loading) return;
  if (dataset?.admin.role !== 'SUPER_ADMIN') return;
  if(route==='delete-paid-ticket'){
    const row=dataset.reservations.find(row=>row.id===reservationId);
    if(!row || row.status!=='PAID' || row.checked_in_at!==null)return;
    if(!confirmedPaidDelete){
      const dialog=$('delete-paid-dialog');
      if(dialog.open)return;
      $('delete-paid-details').textContent=row.first_name+' '+row.last_name+'\n'+row.email+'\n'+row.category+'\nExpected amount: '+Tubarao.euro(row.amount_cents);
      $('delete-paid-cancel').onclick=()=>dialog.close();
      $('delete-paid-confirm').onclick=()=>{dialog.close();review(route,reservationId,button,true);};
      dialog.showModal();return;
    }
  }
  const deleting=route==='delete-record'||route==='delete-paid-ticket';
  if (route === 'delete-record') {
    const row = dataset.reservations.find(row => row.id === reservationId);
    if (!row?.can_delete || !['RESERVED','REJECTED','EXPIRED'].includes(row.status)) return;
    const warning = row.status === 'RESERVED'
      ? 'Delete this active reservation?\n\nThe reserved spot will immediately become available again.\nOnly continue if the customer should no longer keep this reservation.'
      : 'Delete this reservation record?\n\nThis action is permanent and should only be used for obsolete or duplicate records.';
    if (!window.confirm(warning)) return;
  }
  if (route === 'confirm-external-payment') {
    if (!dataset.reservations.some(row => row.id === reservationId && ['RESERVED','EXPIRED','PAYMENT_CLAIMED'].includes(row.status))) return;
    if (!window.confirm('Confirm this simulated payment? No money will move.')) return;
  }
  if (route === 'resend-ticket' && !dataset?.reservations.some(row => row.id === reservationId && row.status === 'PAID')) return;
  reviewing = true; const current = generation; let deleteSucceeded = false;
  paymentButtons().forEach(button => button.disabled = true);
  const message = $('verification-message'); message.hidden = false;
  if (route === 'resend-ticket') {
    message.textContent = 'ISSUING...';
    if (button) button.textContent = 'ISSUING...';
  }
  if (deleting) { message.textContent = 'DELETING...'; if (button) button.textContent = 'DELETING...'; }
  try {
    const result = await adminRequest('/api/admin/payments?action=' + route,{reservation_id:reservationId});
    if (current !== generation) return;
    if (deleting) {
      if (result.deleted !== true || result.reservation_id !== reservationId) throw new Error('Deletion could not be verified. Refresh the dashboard.');
      deleteSucceeded = true;
      dataset.reservations = dataset.reservations.filter(row => row.id !== reservationId); renderDashboard();
      message.textContent = route==='delete-paid-ticket'?'PAID TICKET DELETED':'RECORD DELETED'; return;
    }
    if (route === 'resend-ticket') {
      message.textContent = result.ticket_email_pending ? 'Demo ticket is being prepared.'
        : result.ticket_email_error || (result.ticket_email_sent ? 'TICKET ISSUED' : 'Demo ticket not issued. Use RETRY TICKET.');
      return;
    }
    message.textContent = result.status === 'PAID'
      ? result.ticket_email_pending ? 'Payment confirmed. Demo ticket is being prepared.'
        : result.ticket_email_error ? 'Payment confirmed. ' + result.ticket_email_error
          : result.ticket_email_sent ? 'Payment confirmed. Demo ticket issued.' : 'Payment confirmed. Demo ticket not issued. Use RETRY TICKET.'
      : result.status === 'REJECTED' ? 'Claim rejected. The place is available again.' : 'The claim has expired. No payment was confirmed.';
  } catch (error) { if (current === generation) message.textContent = error.message; }
  finally {
    reviewing = false;
    if (current === generation) {
      if (deleting && !deleteSucceeded) { if (button) button.textContent = route==='delete-paid-ticket'?'DELETE PAID TICKET':'DELETE RECORD'; paymentButtons().forEach(button => button.disabled = false); }
      else await refreshDashboard();
    }
  }
}
window.TubaraoManagement?.init({request:adminRequest,refresh:refreshDashboard});
$('download-guest-list').onclick = async () => {
  if (downloadingGuestList || !dataset?.event || dataset.admin.role !== 'SUPER_ADMIN') return;
  downloadingGuestList = true;
  const current = generation;
  const button = $('download-guest-list'), message = $('guest-list-message');
  button.disabled = true;
  message.hidden = false;
  message.textContent = 'Preparing guest list…';
  try {
    const file = await adminRequest('/api/admin/events?action=guest-list-pdf',undefined,{
      download:'pdf',eventId:dataset.event.id
    });
    if (current !== generation) return;
    const url = URL.createObjectURL(file.blob), link = document.createElement('a');
    link.href = url;
    link.download = file.filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url),60000);
    message.textContent = 'Guest list downloaded.';
  } catch (error) {
    if (current === generation) message.textContent = error.message;
  } finally {
    downloadingGuestList = false;
    button.disabled = !dataset?.event;
  }
};
let downloadingBackup = false;
$('download-backup').onclick = async () => {
  if (downloadingBackup || !dataset?.event) return;
  downloadingBackup=true; const current=generation;
  $('download-backup').disabled=true; $('backup-message').hidden=false; $('backup-message').textContent='Preparing backup…';
  try {
    const file=await adminRequest('/api/admin/events?action=backup',undefined,{download:true});
    if(current!==generation)return;
    const url=URL.createObjectURL(file.blob), link=document.createElement('a');
    link.href=url;link.download=file.filename;document.body.appendChild(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
    $('backup-message').textContent='Backup downloaded. Keep it private. Live duplicate-check protection requires the online scanner.';
  } catch(error) { if(current===generation)$('backup-message').textContent=error.message; }
  finally { downloadingBackup=false;if(current===generation)$('download-backup').disabled=!dataset?.event; }
};
$('login-form').addEventListener('submit',async event => {
  event.preventDefault(); const current=++generation;
  const code=$('access-code').value.trim();$('access-code').value='';
  $('login').disabled=true;$('auth-message').hidden=false;$('auth-message').textContent='Checking access…';
  try {const identity=await Tubarao.request('/api/admin/auth?action=login',{body:{code}});if(current===generation)await showIdentity(identity);}
  catch(error){if(current===generation)$('auth-message').textContent=error.message;}
  finally{$('login').disabled=false;}
});
$('logout').onclick = async () => {
  generation++;hideDashboard();$('auth-message').hidden=false;$('auth-message').textContent='Signing out…';
  try{await Tubarao.request('/api/admin/auth?action=logout',{body:{}});$('logout').hidden=true;$('auth-message').textContent='Signed out.';}
  catch{$('logout').hidden=false;$('auth-message').textContent='Sign-out could not finish. Tap LOGOUT to retry.';}
};
['filter-first','filter-last','filter-email','filter-category','filter-status','attendee-sort'].forEach(id => $(id).addEventListener('input',renderPaidAttendees));
(async () => {
  const current=generation;
  try{const identity=await Tubarao.request('/api/admin/auth');if(current===generation)await showIdentity(identity);}
  catch{$('auth-message').hidden=false;$('auth-message').textContent='Access is unavailable. Refresh to try again.';}
})();
setInterval(() => { if (!document.hidden && dataset) refreshDashboard(); },30000);
window.addEventListener('focus',()=>{ if (dataset) refreshDashboard(); });
