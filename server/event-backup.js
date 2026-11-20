'use strict';
const {requireAdmin,currentEvent,allRows} = require('./backend');
const COLUMNS = ['First Name','Last Name','Email','Category','Type','Status','Amount EUR','Checked In','Checked In At'];
function csvCell(value) {
  let text = String(value ?? '');
  // Quoting alone does not prevent spreadsheet formula execution on untrusted text.
  if (/^[\s\uFEFF]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"','""') + '"';
}
function backupFilename(event) {
  const name = String(event.name || 'Event').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,70) || 'Event';
  const date = event.starts_at && Number.isFinite(Date.parse(event.starts_at))
    ? new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Lisbon',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(event.starts_at)) : '';
  return 'Tubarao_' + name + (date ? '_' + date : '') + '_backup.csv';
}
async function eventBackup(db,req) {
  await requireAdmin(db,req); // SUPER_ADMIN only, before any event or guest reads.
  const event = await currentEvent(db);
  const [reservations,nonPaying] = await Promise.all([
    allRows(db,'reservations','first_name,last_name,email,category,status,amount_cents,checked_in_at',event.id),
    allRows(db,'non_paying_attendees','first_name,last_name,email,category,checked_in_at',event.id)
  ]);
  const rows = [COLUMNS];
  for (const row of reservations) rows.push([row.first_name,row.last_name,row.email,row.category,'PAID',row.status,(row.amount_cents/100).toFixed(2),row.checked_in_at ? 'YES' : 'NO',row.checked_in_at]);
  for (const row of nonPaying) rows.push([row.first_name,row.last_name,row.email,row.category,'NON-PAYING','NON-PAYING','0.00',row.checked_in_at ? 'YES' : 'NO',row.checked_in_at]);
  // UTF-8 BOM and CRLF make the download readable in Excel and Google Sheets.
  return {filename:backupFilename(event),csv:'\uFEFF' + rows.map(row=>row.map(csvCell).join(',')).join('\r\n') + '\r\n'};
}
module.exports = {eventBackup,csvCell,backupFilename};
