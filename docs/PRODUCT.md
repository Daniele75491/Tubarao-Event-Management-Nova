# Tubarão product specification

> Original product requirements for context. [Nova demo isolation](NOVA-DEMO.md) governs classroom operation and replaces the external social, payment and ticket email steps below.

## Purpose and scope

Tubarão is a real private house party in Carcavelos supported by simple technology, primarily for the current academic year. It was founded by 10 house residents studying for a Master's in Management, largely connected to Nova SBE but welcoming other university, Erasmus, and wider social circles.

The first party used WhatsApp invitations and direct transfers. Invitations spread beyond the intended network; guests paid after deadlines, on the event day, or during the party and expected entry. Organizers lacked a reliable link between payment, capacity, and tickets, struggled to plan alcohol purchases, and had no proper check-in system.

The platform is the official ticketing gatekeeper:

**Event → ticket → payment → valid entry.**

A payment alone is never a valid ticket. The official ticket/QR database is the source of truth at the door.

This document specifies approved product requirements. The frontend now calls Vercel serverless routes backed by the existing Supabase database and RPCs. Supabase is the production source of truth. Revolut verification remains manual. Server-side QR generation and Resend ticket delivery now follow admin confirmation. Mobile admin QR and manual check-in are implemented locally; see [TECHNICAL.md](TECHNICAL.md). Deployment and live smoke testing remain separate from local implementation.

## Event format and configuration

Use synthetic event settings in the classroom. Read capacity, pricing and hold durations from the active backend event. Exact capacity and category limits are private.

Parties normally happen on Sundays in the private garden, around 18:00–22:30, with open bar included. Initial scale is described as approximately 100–120 guests, potentially growing toward 150 only as operations become established. That approximate scale does not override the physical-capacity calculation below.

| Parameter | Original schema / prototype seed | Rule |
| --- | --- | --- |
| Physical capacity | 120 people total | Includes residents |
| Non-paying attendees | Initially 10 resident reservations | Named residents/invited guests reserve physical places without paid sales or revenue |
| Sellable guest tickets | 110 | Derived, never a permanent constant |
| Men ticket cap | 45 | Editable category limit |
| Women ticket cap | No fixed category cap | Still limited by total sellable capacity |
| Regular price | €8.00 | Final displayed price |
| Active price | EARLY / LATE event settings | Database time and AUTO/EARLY/LATE mode select the price for new reservations |
| Typical day | Sunday | Event dates remain editable |
| Typical time | 18:00–22:30 | Event times remain editable |
| Public availability | AVAILABLE / FEW TICKETS LEFT / SOLD OUT | No exact inventory |

These historical seed values are not the current event settings, immutable business rules or permission to hardcode future events. Sellable capacity always uses the actual non-paying attendee count.

## Community and access

The official account is [@casitatubarao](https://www.instagram.com/casitatubarao/). Existing Instagram actions use this exact URL and open externally. Following remains self-confirmed; there is no username collection or approval process.

The community flow is real-world social network → private Tubarão Instagram → event announcements → ticket link → purchase → party. Early events also help grow the private Instagram community.

Guests must be instructed to follow the private page before purchasing. A self-confirmation checkbox is sufficient; technical follow verification is not required. Do not collect Instagram usernames. The Super Admin must eventually be able to edit the Instagram handle, URL, and follow instruction.

There is no application, request-access, guest-approval, or manual pre-payment approval flow. Social distribution and the private Instagram page provide sufficient filtering at this stage. A specific unwanted ticket holder may be handled manually through cancellation/refund.

## Public purchase flow

Near reservation submission, show: “By continuing, you acknowledge that you have read our Privacy Notice.” Link Privacy Notice to `/privacy.html` in a new tab to preserve checkout. This is acknowledgement, not optional-processing consent. The concise notice covers names, email, category, reservation/payment and ticket/check-in information; event operations and transactional emails; no data sales; limited organizer/door-staff and technical-provider access; necessary retention followed by deletion/anonymization where appropriate; and Instagram contact. Do not invent a legal entity or address.

1. Guest opens the event link, usually from Instagram.
2. Landing screen presents the original shark logo, date, time, open bar, and minimal event information.
3. Guest sees the follow instruction and an OPEN INSTAGRAM button or equivalent.
4. Guest confirms “I follow @casitatubarao” or equivalent using the configured handle.
5. Ticket options become available only after confirmation.
6. Guest selects WOMEN TICKET or MEN TICKET and sees qualitative availability and one final price.
7. Guest enters first name, last name, and email. Do not collect phone number or Instagram username; do not require a guest account or password.
8. Guest must confirm the correct ticket category, with this rule clearly displayed:

   > Please select the correct ticket category. Tickets purchased under the wrong category may be cancelled and refunded.

9. Submitting valid details creates a 20-minute reservation with a locked amount and category. Show YOUR SPOT IS RESERVED, Complete your payment within 20 minutes., and a countdown based on reserved_until (initially about 20:00).
10. Revolut is the only payment method. Show PAY followed by the reservation’s locked amount WITH REVOLUT. The button opens the server-provided payment_url for that amount. No Revolut API is used.
11. I’VE PAID changes RESERVED to PAYMENT_CLAIMED. Show PAYMENT RECEIVED, We’re verifying your payment., and Once confirmed, your ticket and QR code will be sent to your email. Add the secondary reminder: Can’t find it? Check your spam or junk folder too. Retain a spam/junk reminder wherever customer copy directs guests to their emailed ticket. This is a claim, not payment confirmation or ticket issuance.
12. An authorized admin checks the actual Revolut payment and confirms or rejects it. The authenticated backend calls confirm_payment or reject_payment. Confirmation marks PAID, records the authenticated admin, ensures the secure QR token hash, and attempts ticket email delivery. Email failure never reverses PAID. Customer checkout never exposes a QR.

Target experience: understand the event, follow, select, enter details, reserve, pay, and submit a claim with minimal friction. Manual verification and email delivery follow later; they are not instant.

## Capacity and category logic

**Maximum paid capacity = physical capacity − non-paying attendee count.**

**Total attendees = paid attendees + non-paying attendees.**

The named Non-paying Attendees list is the sole source of non-paying capacity. It includes residents, invited guests, and any other manually admitted non-paying person. Admin can add/remove names and see their count separately from paid ticket holders. There is no additional Residents deduction and these records create no paid sales or revenue. At 120 physical places, 10 non-paying entries leave 110 paid places; 11 leave 109 and 12 leave 108.

Reject additions and physical-capacity reductions that would make paid plus non-paying attendance exceed physical capacity. Removing an entry releases its place. The Men cap remains a separate paid-category limit (default 45); total capacity takes precedence even if this nominal cap exceeds maximum paid capacity.

The live non-paying list comes only from Supabase. Old browser records and resident placeholders are not imported or counted.

Two categories exist: WOMEN and MEN. The men cap exists because residents are overwhelmingly male and organizers want to avoid an event heavily skewed toward men. The current men cap is 45 and must remain configurable. Women have no fixed category-specific maximum.

Ticket issuance must respect both the total guest limit and, for men, the category cap. With 110 sellable tickets and a men cap of 45, all of these represent a sold-out event:

- 45 men + 65 women.
- 35 men + 75 women.
- 20 men + 90 women.

Once 45 men tickets are sold, MEN becomes SOLD OUT. Women tickets may remain available until the total limit is reached. No category may bypass the total limit. Refunded/cancelled tickets become invalid, and released inventory may become available again when capacity and sales conditions allow.

Do not invent invasive identity checks to enforce categories. Staff must see the ticket category at check-in, and authorized admins must be able to cancel/refund incorrectly purchased tickets. Buying a women ticket must not be treated as an accepted workaround for a sold-out men category.

## Public availability and internal counts

Guests must never see exact capacity, tickets sold against capacity, category stock, or remaining inventory. Prohibited public examples include `43 / 45`, `92 / 110`, and “3 tickets remaining”.

Use AVAILABLE, FEW TICKETS LEFT, and SOLD OUT. Few Tickets Left thresholds must eventually be editable in the Super Admin Edit Zone. Numerical prototype thresholds are implementation seeds, not approved permanent settings.

Only SUPER_ADMIN management views may expose exact capacity and revenue numbers. Public views and responses must not expose the internal capacity metrics in the production product.

## Pricing and sales timing

Ticket pricing has configurable EARLY and LATE prices, initially €8/€12 in the new-event form. Existing events retain their original price for both tiers after migration until SUPER_ADMIN configures them. Displayed pricing comes from the database-backed event API; create_reservation independently locks the tier and amount in its transaction. The legacy events.ticket_price_cents column is retained only for migration compatibility. Revenue sums actual amount_cents for PAID reservations only. No payment-cost calculation or additional charge is displayed.

AUTO uses the dedicated early_price_ends_at: before the deadline is EARLY; at or after it is LATE. NULL keeps EARLY indefinitely. FORCE EARLY / FORCE LATE override the deadline for new reservations only and require UI confirmation when selected. Sales OPEN/CLOSED/SCHEDULED remain independent. Prices are positive integer cents, limited to €1,000.00 per ticket.

The active event is resolved server-side: is_active=true, prefer sales_mode OPEN or SCHEDULED, then newest created_at (ID breaks ties). If none match those modes, use the newest active event. Never hardcode an event UUID or the test event name.

OPEN bypasses the schedule but never capacity. CLOSED blocks reservations. SCHEDULED follows sales_open_at and optional sales_close_at. The existing RPC accepts the exact closing timestamp; API availability matches that boundary. Database UTC timestamps determine reservation deadlines. Public availability refreshes on load, after reservation, and every 30 seconds while visible.

## Payments and valid entry

Revolut is the only payment method. The backend uses Supabase for persisted orders, reservations, payment claims, tickets, and authorized admin decisions. The payment destination is a Revolut personal payment link; its actual URL has not been supplied. No payment API or automatic verification is assumed.

**20-minute reservation → Revolut personal payment link → I’VE PAID / PAYMENT_CLAIMED → admin confirms → PAID → QR generated server-side → ticket emailed.**

**Admin rejection → REJECTED. Paid ticket email → QR → authenticated admin check-in.**

| State | Capacity and action |
| --- | --- |
| RESERVED | Holds one place and category allocation for the server-configured duration (currently 20 minutes) from creation. Inaction expires the reservation. |
| PAYMENT_CLAIMED | Claimed before expiry; protected until claimed_at + events.claim_hold_hours (currently 24 hours), or admin review. The original 20-minute timer no longer applies. No ticket yet. |
| PAID | Admin confirmed the actual payment. Counts toward paid attendance and revenue. |
| REJECTED | Admin rejected the claim; no ticket, held capacity released. |
| EXPIRED | Reservation deadline or payment-claim hold elapsed; no ticket, held capacity released. |

Capacity checks must include PAID, active RESERVED, protected PAYMENT_CLAIMED, and non-paying attendees. Men holds count toward the Men cap. Claims and reservations do not count as paid attendance or revenue. Reject settings or non-paying additions that would consume protected places.

Supabase stores all reservation and payment states. Local storage keeps only the reservation ID and email for recovery across closed tabs. It is never proof of payment. Checkout verifies the cached record with the backend before showing actionable or confirmed state. The server creates the QR and attempts email only after admin-confirmed PAID. Nothing is issued when the customer merely claims payment. Old local demo records are ignored. A personal transfer alone never grants entry.

## Tickets, cancellation, and refunds

Tickets are individual and non-transferable. A guest unable to attend should request a refund rather than transfer the ticket.

Preferred refund flow:

**Guest requests refund → Admin/Super Admin evaluates → refund approved → ticket invalidated → capacity released.**

A refunded or cancelled ticket must not permit entry. Released inventory may be sold again if capacity and sales conditions allow. Admins must eventually be able to cancel/refund incorrect-category tickets and manually handle specific unwanted guests.

Refunds need an editable allowed yes/no setting and deadline, reflecting advance alcohol purchasing. No permanent deadline is specified. The detailed refund conditions, amounts, failure handling, and precise Admin permissions remain undecided; do not invent them.

## QR and ticket presentation

Every paid reservation receives one reproducible, opaque ticket token derived server-side with versioned HMAC-SHA256 from the reservation/event IDs and TICKET_SIGNING_SECRET. The QR payload is TUBARAO:<token>; it contains no name, email, category, price or plaintext reservation ID. Only SHA-256(token) is stored in qr_token_hash. Plaintext tokens are never stored in the application database.

Do not encode name, email, category, or payment details directly in the QR. Scanning looks up the token securely. Staff retrieve the necessary ticket information through the authorized interface.

The visual ticket should prominently display TUBARÃO, YOU'RE IN., event date, QR code, and ticket identifier. It should be attractive enough to screenshot/share, while remaining individual, non-transferable, and usable only once at entry. Sharing an image does not grant additional admission rights.

This phase delivers a minimal English email with YOU’RE IN., first name, actual stored category/amount, and a PNG QR embedded using a CID attachment. The ticket is private and intended for single-use check-in. No QR is displayed in checkout or the informational ticket page. No PDF export is added.

## Email delivery and recovery

Email success records ticket_sent_at and clears ticket_email_error. Each delivery attempt records its timestamp and increments ticket_email_attempts. Failure keeps PAID, preserves any previous successful-send timestamp and stores only a safe error description. Repeated CONFIRM PAID never automatically sends another email after an attempt; an authorized admin can explicitly resend. Resend works only for PAID and reproduces the same QR. Concurrent requests use an atomic attempt-counter update to elect one sender.

Resend acceptance is not an inbox-delivery guarantee. A timeout or process failure after Resend acceptance can leave delivery uncertain; organizers should check before resending. The existing signing secret must remain stable across deployments and be backed up securely.

## Check-in

LIVE ATTENDANCE below the scanner and manual search is available to both door ADMIN and SUPER_ADMIN. It includes current-event PAID reservations with checked_in_at and non-paying attendees with checked_in_at. TOTAL INSIDE, MEN, WOMEN and their percentages use all arrivals; zero attendance yields 0%. The list shows only names, category, paid/non-paying type and Lisbon check-in time. Local sorting/filtering affects only the list, never KPI totals.

Refresh every five seconds while visible and immediately after successful QR/manual check-in, preserving selections and scanner state. Temporary update failures retain the previous list with LIVE UPDATE UNAVAILABLE. Presence does not introduce checkout/check-out or non-paying check-in controls: “inside” means an eligible checked-in record, with no departure tracking in the existing schema.

The dedicated /checkin.html page uses the same access-code login. Ticket email → QR → admin scanner → server hashes the opaque token → atomic database check-in. Every scan requires a verified active ADMIN/SUPER_ADMIN access account and a current-event PAID reservation. The service-only check_in_ticket RPC records checked_in_at and checked_in_by_access_id; repeat scans return ALREADY_CHECKED_IN with the original time. The database is the authority for simultaneous scans.

The rear-camera scanner pauses on detection and resumes only after SCAN NEXT. Large CHECKED IN, ALREADY CHECKED IN and INVALID TICKET states show the name/category where appropriate. A failed request shows CHECK NOT COMPLETED and never authorizes admission. Camera permission denial has a name/email-search fallback. Search shows only current-event reservations; only unused PAID rows offer CHECK IN, invoking check_in_reservation with the authenticated admin. Non-paying attendees have no QR or check-in action in this phase.

The dashboard links to CHECK-IN; the scanner links BACK TO ADMIN. Camera use requires HTTPS and browser permission. Physical iPhone Safari/Android Chrome testing and live database concurrency verification remain production checks.

Use a mobile web interface on staff phones; no dedicated iOS/Android app is needed. Multiple admins use the database RPCs for atomic single-use admission.

A successful scan checks in immediately and shows CHECKED IN, full name and category. A later scan shows ALREADY CHECKED IN and the original time. INVALID TICKET covers unknown, other-event or non-PAID tickets. The database must prevent QR reuse, including simultaneous attempts by different admins. Manual search uses an explicit CHECK IN button for the selected unused PAID guest.

## Internal roles and permissions

### SUPER_ADMIN

Full access to the existing dashboard, events/sales settings, payment confirmation/rejection/resend, non-paying attendees, attendee list, revenue/KPIs and check-in. Future refund, advanced export, Instagram editing and permission controls remain unimplemented.

### ADMIN

Door/check-in only: QR scanning, attendee search by name/email and manual admission. Door accounts identify devices/shifts, not named people. No dashboard, payments, events, non-paying management or KPIs.

Access code → server-side scrypt verification → secure HttpOnly session → server-side role authorization. Browser-supplied roles are never trusted. admin.html redirects door accounts to /checkin.html before loading dashboard data. Both pages use ADMIN ACCESS, a password-type Access code input permitting paste, and ENTER. Check-in displays the account label. Logout revokes the session and clears private content.

## Super Admin Edit Zone

Operational parameters must be data editable through the UI. Organizers should not need Codex or code edits to configure each party.

| Area | Intended controls |
| --- | --- |
| Event | Name, date, start/end time, status |
| Capacity | Physical maximum, named non-paying list, automatically derived paid capacity, Men cap |
| Pricing | Regular/late price, regular deadline, late start |
| Sales | Opening/closing date and time, manual open/close |
| Availability | Few Tickets Left thresholds |
| Community | Instagram handle, URL, follow instruction |
| Refunds | Allowed yes/no, deadline |

Only SUPER_ADMIN can edit current-event settings and manage non-paying attendees through authenticated APIs. SUPER_ADMIN alone can create and activate events. The local event-management migration must be applied before these mutations work in production. Advanced pricing, refund, Instagram and permission controls remain future requirements.

## Dashboard

The latest frontend layout places PAYMENT VERIFICATION prominently beneath the KPIs, followed by sales controls and full-width Edit Event, followed by a roughly 67% Paying Attendees / 33% Non-paying Attendees desktop grid. On tablet/mobile, the two attendee sections stack with Paying Attendees first. The complete paying list remains the primary operational attendee section. Provide combinable first-name/last-name search, Women/Men and status filters, and sorting by first name, last name, category, or status. Show Paid / Not checked in and Checked in badges from database checked_in_at, without adding a check-in action. Keep non-paying attendees compact in a closed-by-default accordion with a visible count.

The verification table shows first name, last name, email, category, amount, status, reservation timestamp and claim timestamp. PAYMENT CLAIMED rows offer CONFIRM PAID and REJECT. RESERVED and EXPIRED rows also offer SUPER_ADMIN-only CONFIRM PAID after a Revolut-verification warning, through the atomic external-payment recovery RPC. Authenticated confirmation invokes confirm_payment, then refreshes dashboard data and KPIs. It records confirmed_by_access_id if neither the new nor historical confirmation actor is set, creates the deterministic QR hash if absent and attempts Resend delivery. PAID rows show TICKET SENT or EMAIL NOT SENT, a safe failure message when needed, and RESEND TICKET for all PAID tickets, including already-sent tickets. Authenticated rejection invokes reject_payment and refreshes the dashboard. Rejection releases the held place. All five requested states and the existing CANCELLED state are supported. Reads present expired holds as EXPIRED even before a later RPC persists expiry.

Admin statistics distinguish PAID ATTENDEES, NON-PAYING ATTENDEES, TOTAL ATTENDEES, and REVENUE. Revenue comes only from paid records. Internal users may also see paid category counts/caps and future check-in figures. For example, 92/110 total, 41/45 men, 51 women, revenue, and check-ins out of 92 are internal-only illustrative metrics, not event defaults.

The future product should give organizers controlled capacity, category limits, confirmed payments, guest records, QR validation, check-in, revenue visibility, and editable parameters while keeping the guest experience simple.

## Open decisions and interpretation limits

- Actual Revolut personal payment URL and reconciliation procedure. Only SUPER_ADMIN may verify payments.
- Actual per-event dates, prices, timing, thresholds, and future capacity adjustments beyond current defaults.
- Refund deadline and detailed policy; final granular Admin permission matrix.
- Production concurrency implementation, price transitions before reservation, and handling payments in progress at sales closure. The 20-minute reservation and current 24-hour claimed hold follow the supplied RPCs.
- Production event state transitions, scheduling time zone, and operational validation beyond the documented V0.3.1 local rules.
- The narrative “100–120 guests” and potential “150 people” do not consistently distinguish guests from total attendees. Use the explicit default of 120 total people including 10 residents (110 sellable tickets); confirm totals before increasing capacity.

No access approval, guest accounts, ticket transfer system, or invasive identity verification is implied by these open decisions.

## Event lifecycle and attendance management

Current-event settings expose name, date/time, physical capacity, MEN paid cap, ticket price, reservation minutes, claim-hold hours and OPEN/CLOSED/SCHEDULED sales. Date/time controls use the explicitly displayed device timezone and send timezone-aware timestamps. Schedule controls are disabled outside SCHEDULED; scheduled sales require an opening time and any closing time must be later. Existing reservations keep their locked amount and reserved_until. Claim-hold changes apply to claims through the existing event-based deadline model.

SUPER_ADMIN creates a new event inactive, then explicitly SET AS ACTIVE EVENT after a confirmation naming the event. The switch updates active flags atomically and preserves all historical events, reservations and attendee records. Existing records are never moved between events. The public event-state endpoint and check-in read the active event; operators must finish the old door session before switching. ACTIVE EVENT prominently shows the dashboard-selected active event, its date/time and sales mode. Inactive events retain names, dates, inactive flags, sales modes and the guarded activation action inside the collapsed-by-default OTHER EVENTS panel. CREATE NEW EVENT sits inside that panel. Desktop places active and other events side by side; mobile stacks active first.

Only SUPER_ADMIN can add/remove named non-paying attendees (first/last name, optional email, MEN/WOMEN). Each occupies one physical place and contributes to total attendance/gender KPIs, never revenue. Removal requires confirmation. No non-paying QR generation is introduced.

Capacity changes and non-paying additions are serialized in the database against reservation writes. Occupancy includes PAID, unexpired RESERVED, unexpired PAYMENT_CLAIMED and non-paying attendees. MEN cap counts only active/paid MEN reservations. Caps cannot be lower than occupancy. Claim-window changes check the larger old/new window so shortening does not evade protection and extending accounts for revived claims. No frontend capacity check substitutes for the database.

PAYING ATTENDEES is the full-width SUPER_ADMIN master list of confirmed paid guests: first name, last name, secondary email, category, check-in status and ticket-delivery status. First-name, last-name and case-insensitive email searches combine with category/status filters using loaded data. Sorting offers first name, last name, MEN first, WOMEN first, checked in first and not checked in first. NON-PAYING ATTENDEES follows below at full width, showing names, category, available check-in status and REMOVE, without displaying email in rows. The optional-email add form and all existing capacity/removal semantics remain. The redundant general ATTENDEES UI is removed; pending claims remain in Payment Verification. Revenue and attendance KPIs remain unchanged.

## Event backup

SUPER_ADMIN can DOWNLOAD EVENT BACKUP for the current active event. ADMIN door accounts cannot export. The CSV includes all reservations and non-paying attendees, with first/last name, email, category, type, stored status, actual amount, and check-in information. Type PAID labels reservation rows; only Status PAID indicates confirmed payment. The download never changes attendee state and contains no internal IDs, QR material or credentials.

This is an emergency/manual fallback for door operations, not live synchronization or payment proof. A snapshot may become stale. QR scanning still requires the online backend for live duplicate-check protection. Keep exported personal data private and delete backups when no longer needed.


## Returning customers and externally verified payments

A customer entering the same normalized first name, last name, email and category resumes an active reservation for the current event. RESERVED retains its original server deadline and price; PAYMENT_CLAIMED returns to PAYMENT RECEIVED; PAID returns to TICKET CONFIRMED with email/inbox guidance and no website QR. Identity mismatch returns a generic conflict without details. Expired/rejected reservations use normal new-reservation rules. Browser recovery automatically revalidates the saved UUID/email; storage is never payment proof.

SUPER_ADMIN may confirm a RESERVED booking after explicitly verifying the transfer in Revolut. An EXPIRED booking may also be restored, but only after a transactional physical/MEN capacity check succeeds. All protected holds and non-paying attendees count. The warning appears before submission; ADMIN/door accounts gain no permissions. REJECTED/CANCELLED bookings cannot be restored this way. Confirmation preserves actual amount, identity and audit history and reuses existing ticket delivery. Email failure leaves PAID and allows RESEND TICKET. Requires the reservation-recovery migration documented in TECHNICAL.md.


## Payment dashboard organization and record deletion

Only PAID reservations with ticket_sent_at populated belong in COMPLETED / TICKETS SENT; every other reservation stays in TO REVIEW. Successful delivery moves a row automatically, without reloading the page. Completed deliveries are newest first in a collapsed-by-default panel; it preserves its open state while refreshing and retains RESEND TICKET. Desktop uses two columns; mobile puts TO REVIEW first and completed below.

SUPER_ADMIN may permanently DELETE RECORD only for stored RESERVED, REJECTED or EXPIRED records with no payment, QR, email-delivery or check-in evidence. PAYMENT_CLAIMED, PAID, checked-in and issued-ticket records are protected regardless of browser manipulation. Deletion targets the exact ID and never another booking sharing the email. An active-reservation warning explains releasing the spot; inactive deletion warns that removal is permanent. Concurrent payment changes prevent deletion. No cancellation/refund or ticket revocation is introduced.


## EARLY / LATE price locking and public presentation

Only the ticket section changes: one active tier/price above the MEN/WOMEN cards, an optional visual AUTO-EARLY deadline countdown, and a muted informational LATE TICKETS section below. SHOW COUNTDOWN and SHOW LATE PRICE are independent SUPER_ADMIN checkboxes, both default off. The Late section stays visible during EARLY, but its configured amount appears only when SHOW LATE PRICE is on. During LATE the active price is always visible and the future section disappears. No exact stock is public. Forced modes have no countdown. Hidden or equal/lower next prices use neutral “PRICE CHANGES IN” copy. Countdown zero requests authoritative state; browser time never selects a reservation price. Network failure cannot create local payment proof or a local price.

An €8 EARLY reservation remains €8 after the deadline or an event-price edit, through recovery and payment claims. Expired records keep their historical amounts; a fresh reservation after the deadline receives LATE pricing. Legacy tiers remain unknown (NULL). PAID amounts, revenue, ticket email, CSV and QR identities are not rewritten. Revenue sums PAID amounts; for example 10 × €8 plus 5 × €12 is €140.

A guest can edit a personal Revolut URL. SUPER_ADMIN must compare the actual incoming payment with the reservation’s EXPECTED AMOUNT; changing the link does not change the database amount or authorize a ticket.


## Removing an accidentally confirmed duplicate

SUPER_ADMIN may use DELETE PAID TICKET for a PAID reservation that has not checked in, including one whose QR/email was already issued. The confirmation names the guest, email, category and stored expected amount, with CANCEL and DELETE TICKET. This is permanent exact-ID deletion, not cancellation/VOIDED history, and sends no email. Same-name/email duplicates are not targeted. The remaining valid reservation continues working.

Deleted rows disappear from payment/completed/paying lists and normal backup CSV. Paid counts, gender shares, attendance and actual-amount revenue recalculate from remaining records; the removed row releases physical capacity and, for MEN, paid MEN occupancy. Its QR and manual lookup become invalid, and its old ID cannot be recovered or resent. Existing RESERVED/REJECTED/EXPIRED delete-record safeguards remain separate.


## Correcting a paid ticket category

SUPER_ADMIN can use CHANGE beside Category in PAYING ATTENDEES. A compact dialog offers WOMEN/MEN, CANCEL and SAVE. Only PAID tickets without check-in qualify. The exact selected reservation is corrected; duplicates remain untouched. WOMEN → MEN requires space within the event MEN cap, including live reserved/claimed holds. MEN → WOMEN releases one MEN slot. Total attendance, physical occupancy, paid amount, tier and revenue remain unchanged.

The existing QR remains valid because category is not signed into its identity. Door lookup reads the corrected category. No email is sent automatically; RESEND TICKET remains available and uses the corrected category. Success updates dashboard lists and gender KPIs, then refetches server data. Public availability follows its existing refresh. DELETE PAID TICKET eligibility remains unchanged.


## Manual reservation amount exception

SUPER_ADMIN can ADJUST AMOUNT beside the expected amount in PAYMENT VERIFICATION, including RESERVED, PAYMENT_CLAIMED and unsent PAID tickets, and beside the amount in COMPLETED / TICKETS SENT. One shared dialog shows the guest/current amount, a euro input, CANCEL and SAVE AMOUNT. It warns that this changes the internal expected/revenue amount only, with no Revolut transfer, charge or refund. The allowed range is €0.01–€1,000.00 with at most two decimal places. PAID records may be corrected even after check-in; check-in state is preserved. REJECTED/EXPIRED/CANCELLED stored states are excluded.

This is an explicit exception after normal reservation creation, not a change to EARLY/LATE rules. LATE €12 may become stored €8 while remaining LATE. Only the exact ID changes; duplicate guests and event prices remain untouched. A private atomic audit records previous/new cents, timestamp and SUPER_ADMIN access ID. Same amount is a no-op. Ordinary paid-ticket deletion still works and leaves the adjustment audit intact.

Payment Verification and PAID revenue use the corrected amount after refresh. Counts, category capacity, attendance and admission are unchanged. Recovery, current payment URLs, backup CSV and subsequent manual ticket resends read the corrected stored amount. Already-open external Revolut pages and already-sent emails cannot be changed; refresh checkout/recover or explicitly resend as appropriate. No money is moved and no email is sent automatically. The same QR remains valid.
