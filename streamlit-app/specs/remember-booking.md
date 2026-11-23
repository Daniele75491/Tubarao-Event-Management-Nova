# Remember a booking through its link

## Why
A guest who reloads the page or closes the tab loses their booking screen and has to look it up again with the reference and email. In the JavaScript version the browser remembered it. Streamlit cannot use browser storage, but it can use the page address.

## What
- After RESERVE MY SPOT, the page address gets `?booking=<booking reference>`.
- Opening an address with `?booking=<reference>` shows that booking: status, category, price and the countdown.
- The link only shows what the booking screen already shows. It never shows the guest's name or email.
- Claiming the payment still needs the guest's email, as before. If the page was reopened from the link, the guest types their email once next to the claim button.
- A link with an unknown or badly formed reference shows "Reservation not found" and the normal event page.
- TRY AGAIN (after EXPIRED, REJECTED or CANCELLED) removes the reference from the address.

## Out of scope
- Remembering the email between visits.
- Remembering staff sign-in (a separate feature).

## Done when
- `logic.booking_by_reference()` returns the guest view for a valid reference and refuses unknown or malformed ones.
- The view has no name or email in it.
- Screen tests: reserving puts the reference in the address; opening the app with that address shows the booking; claiming from a reopened link asks for the email and refuses the wrong one.
- `uv run pytest` is green.
