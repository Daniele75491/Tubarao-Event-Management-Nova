# UX improvements (branch `francesco-ux`)

Text and layout-hint changes to the Streamlit app. No business logic, database, pricing, payment states, auth or QR code was touched.
The only change in `logic.py` is the wording of the user-facing `MESSAGES` dictionary (error codes and rules are unchanged).

## Problems found
- Customers were not told the steps, or that the payment is only a university demo.
- Status texts were short and did not say what to do next.
- Staff messages did not clearly say "admit" or "do not admit".

## Requirement checklist
| Brief item | What changed |
|---|---|
| 3A Booking instructions | "How to book" 4-step box on the landing page; 3-step note on checkout |
| 3B Form labels | Name/email fields say what to enter; category checkbox reads "I confirm that I want a ... ticket" |
| 3C Validation messages | Friendlier `MESSAGES` (bad details, sold out, closed, duplicate email, not found, can't claim) |
| 3D Reservation confirmation | Green "Reservation created... next step" message after RESERVE MY SPOT |
| 3E Payment simulation | "UNIVERSITY DEMO: no real payment" box on the booking page |
| 3F Booking status | Per-state text plus "What do the booking statuses mean?" legend (Reserved, Payment claimed, Confirmed/paid, Expired, Rejected) |
| 4A-F Staff | Check-in how-to (green/yellow/red), success "Admit this guest", duplicate "do not admit again", invalid "DO NOT ADMIT", manual-search instructions, non-paying guest note on success |

## Improvements (`streamlit-app/app.py`)
- Checkout: a 3-step "how it works" note; clearer category-confirmation error; friendlier "welcome back" message.
- Booking page: visible "UNIVERSITY DEMO: no real payment" box; one plain explanation per state
  (RESERVED, PAYMENT_CLAIMED, PAID, EXPIRED, REJECTED) with the next action.
- Door: clearer scan/upload labels, "Welcome in. Admit this guest." on success, "Do not admit a second time" on
  duplicates, "DO NOT ADMIT" with next step on invalid tickets, clearer manual-search instructions and empty result.
- Headings used by tests and branding (logo, shark, hero video) are unchanged.

## How to demo
1. Open the tickets page, tick the Instagram box, GET TICKET, reserve, press SIMULATE.
2. As organizer confirm the claim; as door staff scan/paste the code, then scan it again to see the duplicate warning.

## Tests
- Full existing suite (276 passed, 1 xfailed) plus 3 new UI tests in `tests/test_app.py`.
- Mobile layout was not tested in a real browser.

## Limitations
- Wording only; no layout or CSS redesign.
- Duplicate/invalid wording on the QR path was checked by reading the banner code, not by scanning a real QR.

## Update: contextual booking guidance ("What's next?")
- **Feature:** `next_step_guidance(status)` and `NEXT_STEPS` in `streamlit-app/app.py`. `booking_panel` shows a "What's next?" box for the real status (RESERVED, PAYMENT_CLAIMED, PAID, EXPIRED, REJECTED, CANCELLED). Unknown statuses get a safe fallback. Only real actions are mentioned (SIMULATE, TRY AGAIN, ask the admin).
- **Messages corrected:** removed "as on your ID" from the name fields (no ID matching exists); replaced the spam/junk-folder hint with a note that the demo sends no emails and how to reopen a booking.
- **Tests:** `streamlit-app/tests/test_booking_guidance.py` (per-status text, all states covered, fallback, no misleading wording, booking-page integration RESERVED to PAYMENT_CLAIMED). Spec: `streamlit-app/specs/booking-guidance.md`.
- **Demo:** reserve a ticket, read the box, press SIMULATE and watch the box change.
- **Limitations:** PAID guidance cannot show the QR itself because the admin issues it; EXPIRED and REJECTED were tested through their text, not by waiting for a real expiry.
