"""seed.py — reset the database to a fresh classroom demo.

Run:   uv run python seed.py

It deletes data/tubarao.db and creates:
  * two staff accounts: an organizer (SUPER_ADMIN) and a door phone (ADMIN)
  * an active, open demo event plus an older inactive one
  * four non-paying residents and made-up guests in every booking state

Access codes come from the environment variables TUBARAO_ORGANIZER_CODE and
TUBARAO_DOOR_CODE. If they are not set, random codes are generated, printed
once and saved in data/ACCESS_CODES.txt (ignored by Git).

All names and emails are made up. Emails use the reserved example.test domain.
"""

from __future__ import annotations

import os
import secrets
import unicodedata
from datetime import datetime, timedelta

import db
import logic


def next_sunday_evening(now: datetime) -> datetime:
    local = now.astimezone(logic.LISBON)
    days = (6 - local.weekday()) % 7 or 7
    return (local + timedelta(days=days)).replace(hour=18, minute=0, second=0, microsecond=0)


def seed(conn, organizer_code: str, door_code: str, now: datetime | None = None) -> dict:
    """Fill an empty database with demo data. Returns the two staff identities."""
    now = now or logic.utcnow()
    organizer_id = logic.create_access_account(conn, "Organizer", "SUPER_ADMIN", organizer_code)
    door_id = logic.create_access_account(conn, "Door phone 1", "ADMIN", door_code)
    organizer = {"account_id": organizer_id, "label": "Organizer", "role": "SUPER_ADMIN"}
    door = {"account_id": door_id, "label": "Door phone 1", "role": "ADMIN"}
    secret = db.ticket_secret()

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


def main() -> None:
    path = db.db_path()
    if path.exists():
        path.unlink()
    organizer_code = os.environ.get("TUBARAO_ORGANIZER_CODE") or "org-" + secrets.token_hex(4)
    door_code = os.environ.get("TUBARAO_DOOR_CODE") or "door-" + secrets.token_hex(4)
    conn = db.connect(path)
    seed(conn, organizer_code, door_code)
    conn.close()

    codes = path.parent / "ACCESS_CODES.txt"
    codes.write_text(f"Organizer (SUPER_ADMIN): {organizer_code}\nDoor (ADMIN): {door_code}\n", encoding="utf-8")
    print("Demo database created at", path)
    print("Organizer access code:", organizer_code)
    print("Door access code:     ", door_code)
    print("(Also saved in", codes, "- keep it private.)")


if __name__ == "__main__":
    main()
