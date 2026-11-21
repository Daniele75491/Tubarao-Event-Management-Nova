# Tubarão (Python + Streamlit) rules

These rules apply to everything inside `streamlit-app/`. Where they differ from the repository's root `AGENTS.md` (which describes the JavaScript/Supabase version), the rules in this file win.

## Running things

```
uv run python seed.py          # reset the demo database and print access codes
uv run streamlit run app.py    # open the app
uv run pytest                  # run every check
```

Use `uv run`, never bare `python` or `pip`.

## How to work

- Build each spec on a branch named after it, for example `feature-refunds`. One task per branch and per chat.
- Write the spec first in `specs/<name>.md` with **Why / What / Out of scope / Done when**. Write the failing tests from it before any code.
- After every change, run `uv run pytest` and paste the output. "Done" means the tests are green and the screen was clicked through.
- Never edit, delete, skip or weaken anything in `tests/` to make a check pass. If a test looks wrong, stop and say why.
- Prefer small, reviewable changes. Explain a large refactor before starting it. Do not invent features or settle open decisions by assumption.
- Every claim about the code comes with a file and function name.

## Where code goes

- `app.py` shows screens and collects clicks. It never decides a rule and never writes to the database directly.
- `logic.py` holds every rule. Each action checks the staff role itself with `require_role`. Never trust a role, price, category or event that comes from the screen.
- `db.py` only stores and loads rows. Any change that must stay consistent (capacity, payment, check-in) runs inside one `db.transaction(...)`.
- Functions that depend on time take `now` as an argument so tests can fix the clock.

## Product rules to preserve

- Classroom data only: made-up names and `@example.test` emails. No real payment, email, map or social links.
- The public page shows AVAILABLE, FEW TICKETS LEFT or SOLD OUT. Never show exact capacity, category stock or remaining counts publicly.
- Guests give first name, last name and email only. No phone numbers, Instagram usernames, guest accounts or approval flows. The follow step is self-confirmed.
- Booking flow: RESERVED → simulated claim (PAYMENT_CLAIMED) → organizer PAID or REJECTED. Holds and review windows expire as in `logic.effective_status`. A claim alone never allows entry.
- Capacity counts PAID, live holds, live claims and non-paying attendees. The MEN cap counts only paid-side MEN bookings. Capacity and the MEN cap can never be set below places already taken.
- A booking keeps the price and tier it was created with. Only the organizer's ADJUST AMOUNT changes it, and that is recorded in `reservation_amount_adjustments`.
- SUPER_ADMIN (organizer) can do everything. ADMIN (door) can only check in, search and see live attendance.
- QR tickets contain only `TUBARAO:<token>`. Store only the SHA-256 hash of the token. Re-issuing must reproduce the same QR. Check-in is single-use and only for PAID tickets of the active event.
- Keep the original shark logo unchanged and the black / bone-white / Atlantic-blue look. Public copy stays in English.

## Rules added from experience

Add one line here each time an agent does something wrong, with the reason.
