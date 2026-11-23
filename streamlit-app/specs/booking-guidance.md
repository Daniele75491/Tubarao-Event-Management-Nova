# Contextual booking guidance

**Why:** Guests did not always know what to do next on their booking page.
**What:** `next_step_guidance(status)` in `app.py` returns a short "What's next?" text per real status (RESERVED, PAYMENT_CLAIMED, PAID, EXPIRED, REJECTED, CANCELLED) shown on the booking page. Misleading "as on your ID" and spam-folder wording removed.
**Out of scope:** states, database, payments, QR, auth.
**Done when:** `tests/test_booking_guidance.py` and the full suite pass.
