# Promo codes

## Why
Organizers want to give some guests a discount (for example, the Nova class, friends of the residents or an early promotion) without editing each booking by hand with ADJUST AMOUNT.

## What

**Organizer (dashboard, PROMO CODES section)**
- Create a code for the active event:
  - **code**: 3 to 20 letters, numbers or dashes, saved in capitals (`nova20` becomes `NOVA20`);
  - **percent off**: a whole number from 1 to 90;
  - optional **maximum uses**: at least 1;
  - optional **expiry time**: Lisbon time.
- A code must be unique within its event, ignoring capitals. Another event may reuse it.
- See every code of the active event with its percent, uses (taken / maximum), expiry and whether it is active.
- Deactivate a code and activate it again. Codes are never deleted, so the bookings that used them keep their history.
- Only the organizer (SUPER_ADMIN) can do any of this.

**Guest (checkout)**
- The checkout has an optional **Promo code** field. Capitals and spaces around the code don't matter.
- With a valid code, the booking's price becomes the current EARLY or LATE price minus the percent, rounded to the nearest cent (half a cent rounds up). The booking keeps both the discounted price and the price before the discount, and remembers which code it used.
- With an invalid code, no booking is made, and the guest sees why:
  - "This promo code doesn't exist." (unknown, or belongs to another event)
  - "This promo code is no longer active." (deactivated)
  - "This promo code has expired." (at or after its expiry time)
  - "This promo code has been fully used." (no uses left)
- An empty field means no code, exactly as before.
- The booking screen shows the code and both prices, for example `NOVA20 · €8 → €6.40`.
- Resuming an existing booking (same name, email and category) keeps that booking's original price. A code typed when resuming is ignored.

**Counting uses**
- A use is taken by every booking with that code that still holds a place: RESERVED or PAYMENT_CLAIMED within their time, or PAID. Like a place, a use is freed when a hold expires, a claim is rejected, or a booking is deleted.
- When the organizer restores an expired booking after checking Revolut, that booking keeps its discount, even if the code has run out of uses since then. The guest already paid that price.

**Everywhere else**
- Revenue, the KPIs, the charts and the backup CSV already use each booking's actual amount, so discounts appear there automatically.
- The organizer's payment list shows the code next to the expected amount.

## Out of scope
- Fixed-euro discounts, codes for one category only, and codes shared across events.
- Combining several codes in one booking.
- Showing codes on the public page.

## Done when
- Tests cover:
  - the discount and its rounding, codes in any capitals, and each of the four refusals;
  - uses being freed by expiry and rejection;
  - resuming keeping the original price, and discounts on the LATE price;
  - creating codes (validation, duplicates per event, organizer only), deactivating them, and listing them with uses;
  - an existing database (from before promo codes) being upgraded automatically.
- Screen tests: a guest books with a code and sees the discounted price; a wrong code shows its message and makes no booking; the organizer creates a code from the dashboard.
- `uv run pytest` is green.
