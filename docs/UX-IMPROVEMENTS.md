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
