'use strict';
const {HttpError} = require('./http');
const {requireAdmin,currentEvent,dbResult} = require('./backend');

const dateFormat = new Intl.DateTimeFormat('en-GB',{
  timeZone:'Europe/Lisbon',weekday:'long',day:'numeric',month:'long',year:'numeric'
});
const filenameDate = new Intl.DateTimeFormat('en-CA',{
  timeZone:'Europe/Lisbon',year:'numeric',month:'2-digit',day:'2-digit'
});
const alphabet = new Intl.Collator('en',{sensitivity:'base'});
const sortKey = name => name.trim().replace(/\s+/gu,' ');

async function guestNames(db,table,eventId) {
  const guests = [];
  let after;
  for (;;) {
    let query = db.from(table).select('id,first_name,last_name').eq('event_id',eventId);
    if (table === 'reservations') query = query.eq('status','PAID');
    if (after) query = query.gt('id',after);
    const page = dbResult(await query.order('id').limit(500));
    if (!page.length) return guests;
    for (const {first_name,last_name} of page) guests.push({first_name,last_name});
    after = page.at(-1).id;
    if (page.length < 500) return guests;
  }
}

function guestListFilename(event) {
  const name = event.name.normalize('NFKD').replace(/\p{Mark}/gu,'')
    .replace(/[^A-Za-z0-9.]+/g,'_').replace(/\.{2,}/g,'_').slice(0,70)
    .replace(/^[_.]+|[_.]+$/g,'') || 'Event';
  const date = event.starts_at ? '_' + filenameDate.format(new Date(event.starts_at)) : '';
  return name + '_Guest_List' + date + '.pdf';
}

function renderGuestList(event,guests) {
  const PDFDocument = require('pdfkit');
  const regular = require.resolve('@expo-google-fonts/noto-sans/400Regular/NotoSans_400Regular.ttf');
  const bold = require.resolve('@expo-google-fonts/noto-sans/700Bold/NotoSans_700Bold.ttf');
  const margin = 42, nameX = margin + 40, ink = '#0B0B0B';
  const doc = new PDFDocument({size:'A4',margin,bufferPages:true,info:{Title:event.name + ' | Guest List'}});
  const width = doc.page.width - 2 * margin;
  const nameWidth = width - (nameX - margin);
  const pageBottom = doc.page.height - 62;
  const date = event.starts_at ? dateFormat.format(new Date(event.starts_at)) + '  |  ' : '';
  const numberWidth = String(guests.length).length;
  let y;
  function header() {
    doc.font(bold).fontSize(14).fillColor(ink).text(event.name,margin,margin,{width});
    doc.moveDown(0.18).fontSize(23).text('GUEST LIST',{width});
    doc.moveDown(0.36).font(regular).fontSize(10)
      .text(date + 'Total Guests: ' + guests.length,{width});
    y = doc.y + 12;
    doc.strokeColor('#1F5CFF').lineWidth(0.7).moveTo(margin,y).lineTo(margin+width,y).stroke();
    y += 5;
  }
  header();
  if (!guests.length) doc.fontSize(11).text('No guests to list.',margin,y+10,{width});
  guests.forEach(({last_name,first_name},index) => {
    const name = last_name + ' ' + first_name;
    const textOptions = {width:nameWidth};
    const rowHeight = doc.font(regular).fontSize(11).heightOfString(name,textOptions) + 6;
    if (y + rowHeight > pageBottom) {
      doc.addPage();
      header();
    }
    doc.font(regular).fontSize(11).fillColor(ink);
    doc.text(String(index+1).padStart(Math.max(2,numberWidth),'0'),margin,y+3,{lineBreak:false});
    doc.text(name,nameX,y+3,textOptions);
    y += rowHeight;
    doc.strokeColor('#DEDEDE').lineWidth(0.35).moveTo(margin,y).lineTo(margin+width,y).stroke();
  });
  const {count} = doc.bufferedPageRange();
  for (let page = 0; page < count; page++) {
    doc.switchToPage(page);
    const footer = 'Page ' + (page+1) + ' of ' + count;
    doc.font(regular).fontSize(9).fillColor(ink);
    doc.text(footer,margin+width-doc.widthOfString(footer),doc.page.height-47,{lineBreak:false});
  }
  return new Promise((resolve,reject) => {
    const chunks = [];
    doc.on('data',chunk => chunks.push(chunk));
    doc.once('error',reject);
    doc.once('end',() => resolve(Buffer.concat(chunks)));
    doc.end();
  });
}

async function eventGuestList(db,req) {
  await requireAdmin(db,req,['SUPER_ADMIN'],{touch:false});
  const event = await currentEvent(db);
  if (req.headers['x-event-id'] && req.headers['x-event-id'] !== event.id) {
    throw new HttpError(409,'EVENT_CHANGED','The active event changed. Refresh the dashboard and try again.');
  }
  const [paid,nonPaying] = await Promise.all([
    guestNames(db,'reservations',event.id),
    guestNames(db,'non_paying_attendees',event.id)
  ]);
  const guests = [...paid,...nonPaying].sort((a,b) =>
    alphabet.compare(sortKey(a.last_name),sortKey(b.last_name)) ||
    alphabet.compare(sortKey(a.first_name),sortKey(b.first_name))
  );
  return {filename:guestListFilename(event),pdf:await renderGuestList(event,guests)};
}

module.exports = {eventGuestList};
