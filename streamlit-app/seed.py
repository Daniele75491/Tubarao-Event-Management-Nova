"""seed.py — reset the database to a fresh classroom demo.

Run:   uv run python seed.py          (asks before replacing an existing database)
       uv run python seed.py --yes    (replaces without asking)

It replaces data/tubarao.db with a new database containing:
  * two staff accounts: an organizer (SUPER_ADMIN) and a door phone (ADMIN)
  * an active, open demo event plus an older inactive one
  * four non-paying residents and made-up guests in every booking state

Access codes come from the environment variables TUBARAO_ORGANIZER_CODE and
TUBARAO_DOOR_CODE. If they are not set, random codes are generated, printed
once and saved in data/ACCESS_CODES.txt (ignored by Git).

All names and emails are made up. Emails use the reserved example.test domain.

Safety: both codes are checked before anything happens, the new database is
built in a separate file and only swapped in once it is complete, so a failure
never leaves a half-built database or loses the old one.
"""

from __future__ import annotations

import os
import secrets
import sys
import unicodedata
from datetime import datetime, timedelta

import db
import logic


def next_sunday_evening(now: datetime) -> datetime:
    local = now.astimezone(logic.LISBON)
    days = (6 - local.weekday()) % 7 or 7
    return (local + timedelta(days=days)).replace(hour=18, minute=0, second=0, microsecond=0)


class SetupError(Exception):
    """Setup refused to start (bad codes, or the database already has data). Nothing was written."""


def check_codes(organizer_code, door_code) -> tuple[str, str]:
    """Both staff codes must have at least 8 characters and be different from each other."""
    organizer = organizer_code.strip() if isinstance(organizer_code, str) else ""
    door = door_code.strip() if isinstance(door_code, str) else ""
    if len(organizer) < 8 or len(door) < 8:
        raise SetupError("Both access codes need at least 8 characters.")
    if organizer == door:
        raise SetupError("The organizer and door codes must be different.")
    return organizer, door


def is_empty(conn) -> bool:
    return not db.fetch_one(conn, "SELECT 1 AS x FROM admin_access_accounts LIMIT 1") \
        and not db.fetch_one(conn, "SELECT 1 AS x FROM events LIMIT 1")


def seed(conn, organizer_code: str, door_code: str, now: datetime | None = None) -> dict:
    """Fill an EMPTY database with demo data, all or nothing. Returns the two staff identities.

    The codes are checked before anything is written. Everything below runs in one
    transaction (the logic.py actions join it), so if any step fails, nothing is kept.
    """
    organizer_code, door_code = check_codes(organizer_code, door_code)
    now = now or logic.utcnow()
    secret = db.ticket_secret()  # a file next to the database, not part of the transaction
    with db.transaction(conn):
        if not is_empty(conn):
            raise SetupError("The database already has data. Use a new database file.")
        return _demo_data(conn, organizer_code, door_code, secret, now)


def bootstrap_if_empty(conn, organizer_code, door_code) -> str | None:
    """First start of a hosted copy: set up the demo if the database is empty and both codes
    were provided as secrets. Returns None when all is well, or a message saying why setup
    didn't happen. Nothing is written on failure, so the next start simply tries again."""
    if not organizer_code and not door_code:
        return None
    if not is_empty(conn):
        return None
    try:
        seed(conn, organizer_code, door_code)
    except SetupError as error:
        return f"Setup didn't run: {error}"
    except Exception as error:  # noqa: BLE001 - reported on screen, retried next start
        return f"Setup failed and was undone: {error}"
    return None


def _demo_data(conn, organizer_code: str, door_code: str, secret: str, now: datetime) -> dict:
    organizer_id = logic.create_access_account(conn, "Organizer", "SUPER_ADMIN", organizer_code)
    door_id = logic.create_access_account(conn, "Door phone 1", "ADMIN", door_code)
    organizer = {"account_id": organizer_id, "label": "Organizer", "role": "SUPER_ADMIN"}
    door = {"account_id": door_id, "label": "Door phone 1", "role": "ADMIN"}

    old = logic.create_event(conn, organizer, {
        "name": "Tubarão Opening Party", "starts_at": next_sunday_evening(now) - timedelta(days=28),
        "physical_capacity": 120, "men_paid_cap": 45, "sales_mode": "CLOSED",
    }, now - timedelta(days=40))
    logic.activate_event(conn, organizer, old["id"], now - timedelta(days=40))

    event = logic.create_event(conn, organizer, {
        "name": "Tubarão Classroom Demo", "starts_at": next_sunday_evening(now),
        "physical_capacity": 30, "men_paid_cap": 12,
        "early_price_cents": 800, "late_price_cents": 1200,
        "early_price_ends_at": now + timedelta(days=3), "pricing_mode": "AUTO",
        "show_pricing_countdown": True, "show_late_price_before_start": True,
        "reservation_minutes": 20, "claim_hold_hours": 24, "sales_mode": "OPEN",
    }, now - timedelta(days=2))
    logic.activate_event(conn, organizer, event["id"], now - timedelta(days=2))

    for first, last, category in [("Rui", "Resident", "MEN"), ("Tiago", "Resident", "MEN"),
                                  ("Marta", "Resident", "WOMEN"), ("Duarte", "Invited", "MEN")]:
        logic.add_non_paying(conn, organizer, event["id"], first, last, category, None, now - timedelta(days=2))

    def guest(first, last, category, minutes_ago):
        plain = unicodedata.normalize("NFKD", f"{first}.{last}").encode("ascii", "ignore").decode()
        email = f"{plain}@example.test".lower()
        return logic.reserve(conn, first, last, email, category, now - timedelta(minutes=minutes_ago)), email

    # Paid and issued (one already inside).
    for first, last, category, checked_in in [("Ana", "Demo", "WOMEN", True), ("Bruno", "Demo", "MEN", False),
                                              ("Carla", "Demo", "WOMEN", False)]:
        booking, email = guest(first, last, category, 600)
        logic.claim_payment(conn, booking["reservation_id"], email, now - timedelta(minutes=590))
        logic.confirm_payment(conn, organizer, booking["reservation_id"], now - timedelta(minutes=500), secret)
        if checked_in:
            logic.check_in_manual(conn, door, booking["reservation_id"], now - timedelta(minutes=5))

    # Waiting for the organizer to check the payment.
    for first, last, category in [("Diogo", "Demo", "MEN"), ("Eva", "Demo", "WOMEN")]:
        booking, email = guest(first, last, category, 30)
        logic.claim_payment(conn, booking["reservation_id"], email, now - timedelta(minutes=25))

    guest("Filipa", "Demo", "WOMEN", 5)                     # still inside its 20-minute hold
    guest("Gonçalo", "Demo", "MEN", 90)                     # hold ran out → EXPIRED
    booking, email = guest("Helena", "Demo", "WOMEN", 120)  # claim rejected
    logic.claim_payment(conn, booking["reservation_id"], email, now - timedelta(minutes=115))
    logic.reject_payment(conn, organizer, booking["reservation_id"], now - timedelta(minutes=100))

    return {"organizer": organizer, "door": door, "event": event}


def _remove(path) -> None:
    for extra in ("", "-wal", "-shm", "-journal"):
        candidate = path.parent / (path.name + extra)
        if candidate.exists():
            candidate.unlink()


def main(argv: list[str] | None = None) -> None:
    argv = sys.argv[1:] if argv is None else argv
    path = db.db_path()
    organizer_code = os.environ.get("TUBARAO_ORGANIZER_CODE") or "org-" + secrets.token_hex(4)
    door_code = os.environ.get("TUBARAO_DOOR_CODE") or "door-" + secrets.token_hex(4)

    # 1. Check the codes before touching anything.
    try:
        organizer_code, door_code = check_codes(organizer_code, door_code)
    except SetupError as error:
        print("Nothing was changed:", error)
        sys.exit(1)

    # 2. Ask before replacing existing data.
    if path.exists() and "--yes" not in argv:
        answer = input(f"This replaces {path} and ALL its events and bookings. Type y to continue: ")
        if answer.strip().lower() not in ("y", "yes"):
            print("Nothing was changed.")
            sys.exit(1)

    # 3. Build the new database in a separate file, so the old one stays intact if anything fails.
    new = path.parent / (path.name + ".new")
    path.parent.mkdir(parents=True, exist_ok=True)
    _remove(new)
    try:
        conn = db.connect(new)
        try:
            seed(conn, organizer_code, door_code)
        finally:
            conn.close()
    except Exception as error:  # noqa: BLE001
        _remove(new)
        print("Setup failed, nothing was changed:", error)
        sys.exit(1)

    # 4. Swap it in. On Windows this fails while the app still has the old file open.
    try:
        if path.exists():
            old = db.connect(path)
            old.execute("PRAGMA wal_checkpoint(TRUNCATE)")  # fold any pending changes into the old file
            old.close()
            for extra in ("-wal", "-shm"):
                leftover = path.parent / (path.name + extra)
                if leftover.exists():
                    leftover.unlink()
        os.replace(new, path)
    except (PermissionError, OSError) as error:
        _remove(new)
        print("Could not replace the database because it is in use:", error)
        print("Stop the app first (press Ctrl+C in the window running streamlit), then run seed.py again.")
        sys.exit(1)

    codes = path.parent / "ACCESS_CODES.txt"
    codes.write_text(f"Organizer (SUPER_ADMIN): {organizer_code}\nDoor (ADMIN): {door_code}\n", encoding="utf-8")
    print("Demo database created at", path)
    print("Organizer access code:", organizer_code)
    print("Door access code:     ", door_code)
    print("(Also saved in", codes, "- keep it private.)")


if __name__ == "__main__":
    main()
