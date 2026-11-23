# UX improvements (branch `francesco-ux`)

Copy-only changes to the Streamlit app. No business logic, database, pricing, payment states, auth or QR code was touched.

## Problems found
- Customers were not told the steps, or that the payment is only a university demo.
- Status texts were short and did not say what to do next.
- Staff messages did not clearly say "admit" or "do not admit".

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
- Full existing suite plus `test_booking_page_says_it_is_a_demo_and_explains_each_status`.
- Mobile layout was not tested in a real browser.

## Limitations
- Wording only; no layout or CSS redesign. Non-paying guests share the generic check-in banner.
