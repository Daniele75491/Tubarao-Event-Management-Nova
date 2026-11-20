'use strict';
const {createHmac, createHash, timingSafeEqual} = require('node:crypto');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const QRCode = require('qrcode');

function deriveTicketToken(reservationId, eventId, secret = process.env.DEMO_TICKET_SIGNING_SECRET) {
  if (typeof secret !== 'string' || Buffer.byteLength(secret) < 32) throw new Error('Ticket signing is not configured.');
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(reservationId) || !uuid.test(eventId)) throw new Error('Invalid ticket identifiers.');
  return createHmac('sha256',secret).update(`tubarao-ticket-v1:${reservationId.toLowerCase()}:${eventId.toLowerCase()}`).digest('base64url');
}
function hashTicketToken(token) { return createHash('sha256').update(token).digest('hex'); }
function matchesTokenHash(token, hash) {
  return typeof hash === 'string' && /^[a-f0-9]{64}$/i.test(hash) && timingSafeEqual(Buffer.from(hashTicketToken(token),'hex'),Buffer.from(hash,'hex'));
}
function ticketPayload(token) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('Invalid ticket token.');
  return 'TUBARAO:' + token;
}
function generateQrPng(token) {
  return QRCode.toBuffer(ticketPayload(token),{type:'png',errorCorrectionLevel:'M',margin:6,width:500,color:{dark:'#000000',light:'#FFFFFF'}});
}
const escapeHtml = text => String(text).replace(/[&<>"']/g,char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function ticketMessage(row, png, from) {
  if (!['MEN','WOMEN'].includes(row.category) || !Number.isSafeInteger(row.amount_cents) || row.amount_cents < 0) throw new Error('Invalid ticket details.');
  if (typeof row.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) throw new Error('Invalid ticket recipient.');
  const amount = '€' + (row.amount_cents / 100).toFixed(2);
  const name = escapeHtml([row.first_name,row.last_name].filter(Boolean).join(' '));
  const eventName = escapeHtml(row.events?.name ?? 'Tubarão');
  // Only these local bytes are attached; no remote URLs or attachment paths are sent.
  const logo = readFileSync(path.join(__dirname,'..','assets','tubarao-logo.jpeg'));
  return {
    from, to:[row.email], subject:'Your Tubarão ticket',
    text:`Your Tubarão ticket\n\n${row.first_name}, your payment has been confirmed.\n\nCategory: ${row.category}\nTicket: ${amount}\nEvent: ${row.events?.name ?? 'Tubarão'}\n\nShow your QR code at the door.\n\nKeep your ticket private.\nEach QR can only be checked in once.\n\nTubarão classroom demo`,
    html:`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Your Tubarão ticket</title></head>
<body style="margin:0;padding:0;background-color:#0B0B0B;color:#F3F0E8;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#0B0B0B" style="background-color:#0B0B0B"><tr><td align="center" style="padding:0 16px 36px">
<!--[if mso]><table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;table-layout:fixed">
  <tr><td align="center"><img src="cid:tubarao-logo@tubarao" alt="Tubarão" width="280" height="236" style="display:block;width:280px;max-width:100%;height:auto;border:0"></td></tr>
  <tr><td align="center" style="padding:0 0 32px;color:#F3F0E8">
    <h1 style="margin:0 0 14px;font-size:48px;line-height:52px;font-weight:800;letter-spacing:-2px">YOU’RE IN.</h1>
    <p style="margin:0;font-size:15px;line-height:23px">Your payment has been confirmed.</p>
  </td></tr>
  <tr><td bgcolor="#1F5CFF" height="4" style="height:4px;line-height:4px;font-size:0;background-color:#1F5CFF">&nbsp;</td></tr>
  <tr><td bgcolor="#F3F0E8" style="padding:28px 20px 24px;background-color:#F3F0E8;color:#0B0B0B">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="table-layout:fixed">
      <tr><td colspan="2" style="padding-bottom:24px;font-size:12px;line-height:18px;letter-spacing:3px;font-weight:bold;color:#1F5CFF">TUBARÃO</td></tr>
      <tr><td colspan="2" style="padding-bottom:28px;font-size:28px;line-height:34px;font-weight:bold;overflow-wrap:break-word;word-wrap:break-word">${name}</td></tr>
      <tr>
        <td width="50%" valign="top" style="padding:0 12px 24px 0"><p style="margin:0 0 6px;font-size:10px;line-height:16px;letter-spacing:2px">CATEGORY</p><p style="margin:0;font-size:19px;line-height:25px;font-weight:bold">${row.category}</p></td>
        <td width="50%" valign="top" style="padding:0 0 24px"><p style="margin:0 0 6px;font-size:10px;line-height:16px;letter-spacing:2px">TICKET</p><p style="margin:0;font-size:19px;line-height:25px;font-weight:bold">${amount}</p></td>
      </tr>
      <tr><td colspan="2" style="padding-bottom:26px;overflow-wrap:break-word;word-wrap:break-word"><p style="margin:0 0 6px;font-size:10px;line-height:16px;letter-spacing:2px">EVENT</p><p style="margin:0;font-size:19px;line-height:25px;font-weight:bold">${eventName}</p></td></tr>
      <tr><td colspan="2" align="center" style="padding-top:24px;border-top:1px dashed #0B0B0B">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" bgcolor="#FFFFFF" style="max-width:100%;background-color:#FFFFFF"><tr><td align="center"><img src="cid:ticket-qr@tubarao" alt="Your Tubarão ticket QR code. Show this at the door." width="280" height="280" style="display:block;width:280px;max-width:100%;height:auto;border:0"></td></tr></table>
      </td></tr>
      <tr><td colspan="2" align="center" style="padding-top:20px;font-size:11px;line-height:18px;font-weight:bold;letter-spacing:1px">SHOW THIS QR AT THE DOOR</td></tr>
      <tr><td colspan="2" align="center" style="padding-top:12px;font-size:12px;line-height:19px">Keep this ticket private.<br>Each QR code can only be checked in once.</td></tr>
    </table>
  </td></tr>
  <tr><td align="center" style="padding-top:28px;color:#F3F0E8;font-size:12px;line-height:20px"><span style="font-weight:bold">Tubarão</span><br>Classroom demo</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body></html>`,
    attachments:[
      {filename:'tubarao-ticket.png',content:png.toString('base64'),contentType:'image/png',contentId:'ticket-qr@tubarao'},
      {filename:'tubarao-logo.jpeg',content:logo.toString('base64'),contentType:'image/jpeg',contentId:'tubarao-logo@tubarao'}
    ]
  };
}
module.exports = {deriveTicketToken,hashTicketToken,matchesTokenHash,ticketPayload,generateQrPng,ticketMessage};
