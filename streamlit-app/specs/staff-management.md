# Staff management

## Why
The only way to create or change staff access codes is `seed.py`, which also wipes every event and booking. The organizer cannot add a door phone for a busy night, switch off a lost phone, or change a code that leaked, without losing all data. A hosted copy of the app (needed for the presentation) has no terminal at all.

## What
A **STAFF ACCESS** section on the organizer dashboard (SUPER_ADMIN only):

- **List** every staff account: name, role (ORGANIZER or DOOR), active or not, and last sign-in time. Access codes and their hashes are never shown or returned.
- **Add** an account: a name (1 to 100 characters), a role (door staff = ADMIN, organizer = SUPER_ADMIN), and an access code of at least 8 characters typed twice. A code already used by any other account, active or deactivated, is refused. Sign-in finds the account by its code alone, and only a fingerprint of each code is stored, so codes are never reused.
- **Deactivate** an account: it can no longer sign in, and anyone signed in with it is signed out straight away. **Activate** brings it back with its old code. That is always safe, because no other account can have been given that code.
- **Reset an account's code**: the organizer types the new code twice (at least 8 characters, not used by any other account). The old code stops working at once and that account is signed out everywhere. Resetting your own code signs you out too.
- You cannot deactivate your own account, so there is always at least one active organizer.
- Accounts are never deleted, so check-ins and payment confirmations keep pointing at who did them.

## Out of scope
- Changing an account's role (add a new account instead).
- Deleting accounts.
- Showing or emailing codes. The organizer passes the code to the person themselves.

## Done when
- Tests cover:
  - listing without codes or hashes;
  - adding, with its validation, refusing duplicate codes, and the new code signing in;
  - deactivating, which signs that account out, activating again with the old code, and a deactivated account's code not being reusable;
  - resetting a code: the old code fails, the new one works, and the account is signed out;
  - not deactivating yourself;
  - door staff and signed-out people being refused for every action.
- A screen test adds a door account from the dashboard and signs in with it.
- `uv run pytest` is green.
