# Check in non-paying guests at the door

## Why
Residents and invited guests take a physical place, but door staff cannot check them in. They never appear in LIVE ATTENDANCE, so the count of who is inside is wrong.

## What
- FIND BY NAME also finds non-paying guests of the active event, by first name, last name, full name or email, marked NON-PAYING.
- A non-paying guest who is not inside yet has a CHECK IN button. Pressing it shows CHECKED IN with their name and category.
- Checking in is single-use: a second time shows ALREADY CHECKED IN with the first time.
- Both door staff (ADMIN) and the organizer (SUPER_ADMIN) can do it. Signed-out people cannot.
- A guest from another event, or one who was removed, cannot be checked in (INVALID).
- Once inside, they appear in LIVE ATTENDANCE as NON-PAYING, and in the organizer's list and backup CSV as checked in.
- Non-paying guests have no QR, so the scanner is unchanged.

## Out of scope
- Undoing a check-in.
- Giving non-paying guests QR codes.

## Done when
- `logic.check_in_non_paying()` and the extended `logic.search_attendees()` are covered by tests for each rule above.
- A screen test checks in a resident from FIND BY NAME.
- `uv run pytest` is green.
