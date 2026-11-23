"""logic.py — the rules of Tubarão.

Every decision the app makes lives here: is there space, which price applies,
can this booking be claimed, may this staff member confirm a payment, is this
QR code valid at the door...

The screens in app.py never change data directly. They call a function from
this file, which checks the rules and then asks db.py to save the result.
If a rule says no, the function raises TubaraoError with a short code
(for example "MEN_SOLD_OUT") and a message the screen can show.

The life of a booking
---------------------
    RESERVED ──(guest claims payment)──> PAYMENT_CLAIMED ──(organizer confirms)──> PAID
        │                                     │                                   │
        └─ hold time runs out ─> EXPIRED      ├─ organizer rejects ─> REJECTED    └─ door check-in
                                              └─ review window ends ─> EXPIRED

Most functions take `now` (the current time) as an argument. The screens pass
the real time; the tests pass a fixed time so results are predictable.
"""

from __future__ import annotations

import csv
import hashlib
import hmac
import io
import re
import secrets
import unicodedata
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import db
import tickets

LISBON = ZoneInfo("Europe/Lisbon")
CATEGORIES = ("WOMEN", "MEN")
ROLES = ("ADMIN", "SUPER_ADMIN")
ACTIVE_STATUSES = ("RESERVED", "PAYMENT_CLAIMED", "PAID")

# Public availability shows words, never numbers. Below these many free places
# the public page says FEW TICKETS LEFT. (Kept from the original app.)
FEW_TOTAL = 15
FEW_MEN = 7

MAX_PRICE_CENTS = 100_000  # €1,000.00
SESSION_HOURS = 12
MIN_CODE_LENGTH = 10
LOGIN_FAILURE_LIMIT = 5            # wrong codes allowed from one source...
LOGIN_FAILURE_WINDOW = timedelta(minutes=15)  # ...within this time; then that source waits this long
INSTAGRAM_HANDLE = "@casitatubarao"


class TubaraoError(Exception):
    """A rule said no. `code` is for the program, `message` is for people."""

    def __init__(self, code: str, message: str | None = None):
        self.code = code
        self.message = message or MESSAGES.get(code, "Something went wrong. Try again.")
        super().__init__(self.message)


MESSAGES = {
    "INVALID_INPUT": "Some details look incomplete. Please fill in your first name, last name and a valid email (for example name@example.com), then try again.",
    "EVENT_NOT_FOUND": "No active event is available.",
    "EVENT_SOLD_OUT": "Sorry, this event is sold out. No more tickets are available.",
    "MEN_SOLD_OUT": "Sorry, Men tickets are sold out. Women tickets may still be available.",
    "SALES_CLOSED": "Ticket sales are closed at the moment. Please come back later.",
    "ACTIVE_RESERVATION_EXISTS": "This email already has a reservation or a paid ticket. Use \"Already reserved? Find your booking\" on the event page to reopen it.",
    "RESERVATION_NOT_FOUND": "Reservation not found. Check that the booking reference and the email are exactly the ones you used.",
    "INVALID_RESERVATION_STATUS": "This reservation can no longer be claimed, because it has expired or was already handled. Start a new reservation if tickets are left.",
    "PAYMENT_NOT_CLAIMED": "This reservation is not awaiting payment verification.",
    "UNAUTHORIZED": "Enter your access code to continue.",
    "FORBIDDEN": "This account does not have access.",
    "INVALID_ACCESS_CODE": "INVALID ACCESS CODE",
    "EVENT_CHANGED": "The active event changed. Refresh before making changes.",
    "CAPACITY_TOO_LOW": "Physical capacity cannot be below occupied places.",
    "MEN_CAP_TOO_LOW": "MEN paid cap cannot be below active MEN reservations.",
    "EVENT_FULL": "No physical capacity is available.",
    "ATTENDEE_NOT_FOUND": "Attendee not found in this event.",
    "RESERVATION_NOT_DELETABLE": "This record cannot be deleted. Refresh and check its payment and ticket status.",
    "PAID_TICKET_NOT_DELETABLE": "This ticket is no longer eligible for deletion. Refresh the dashboard.",
    "CATEGORY_NOT_EDITABLE": "Only paid tickets that have not checked in can be edited. Refresh the dashboard.",
    "MEN_TICKETS_FULL": "MEN tickets are full. The category was not changed.",
    "AMOUNT_NOT_EDITABLE": "Only reserved, payment-claimed or paid reservations can be adjusted. Refresh the dashboard.",
    "INVALID_AMOUNT": "Enter an amount between €0.01 and €1,000.00.",
    "TICKET_NOT_FOUND": "Issued demo ticket not found for the active event.",
    "TICKET_HASH_MISMATCH": "Ticket signing key does not match the existing ticket. Restore the original signing secret.",
    "PAYMENT_NOT_CONFIRMED": "Only paid reservations can receive a ticket.",
    "PROMO_CODE_NOT_FOUND": "This promo code doesn't exist.",
    "PROMO_CODE_INACTIVE": "This promo code is no longer active.",
    "PROMO_CODE_EXPIRED": "This promo code has expired.",
    "PROMO_CODE_USED_UP": "This promo code has been fully used.",
    "INVALID_PROMO_CODE": "Use 3 to 20 letters, numbers or dashes, a percent from 1 to 90, "
                          "and at least 1 use if you set a limit.",
    "PROMO_CODE_EXISTS": "This event already has that code.",
    "CODE_IN_USE": "Choose a different access code.",
    "TOO_MANY_ATTEMPTS": "Too many wrong codes. Wait 15 minutes and try again.",
    "STAFF_NOT_FOUND": "Staff account not found. Refresh the dashboard.",
    "CANNOT_CHANGE_SELF": "You can't deactivate your own account.",
}

TICKET_FAILED = "Demo ticket could not be issued. Use RETRY TICKET."
TICKET_MISMATCH = MESSAGES["TICKET_HASH_MISMATCH"]


# ================================================================ time and text helpers

def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def to_iso(value: datetime | str | None) -> str | None:
    """Store every time as UTC text, e.g. 2026-12-06T17:00:00+00:00."""
    if value is None or value == "":
        return None
    if isinstance(value, str):
        value = parse_time(value)
    if value.tzinfo is None:
        raise TubaraoError("INVALID_EVENT_TIME", "Use date/time values with a time zone.")
    return value.astimezone(timezone.utc).isoformat(timespec="seconds")


def parse_time(value: str | datetime | None) -> datetime | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise TubaraoError("INVALID_EVENT_TIME", "Use valid date/time values.") from error
    if parsed.tzinfo is None:
        raise TubaraoError("INVALID_EVENT_TIME", "Use date/time values with a time zone.")
    return parsed


def lisbon(value: str | datetime | None, pattern: str = "%d %b %Y, %H:%M") -> str:
    """Show a stored time in Lisbon time, the event's local time zone."""
    moment = parse_time(value)
    return moment.astimezone(LISBON).strftime(pattern) if moment else "—"


def money(cents: int | None) -> str:
    """Internal money format: €8.00."""
    return "—" if cents is None else f"€{cents / 100:,.2f}"


def public_price(cents: int | None) -> str:
    """Public price format drops .00: €8 but €8.50."""
    if cents is None:
        return "—"
    return f"€{cents // 100}" if cents % 100 == 0 else f"€{cents / 100:.2f}"


def _new_id() -> str:
    return str(uuid.uuid4())


_CONTROL = re.compile(r"[\x00-\x1f\x7f]")
_EMAIL = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def clean_name(value) -> str:
    if not isinstance(value, str):
        raise TubaraoError("INVALID_INPUT")
    result = value.strip()
    if not result or len(result) > 100 or _CONTROL.search(result):
        raise TubaraoError("INVALID_INPUT")
    return result


def clean_email(value) -> str:
    if not isinstance(value, str):
        raise TubaraoError("INVALID_INPUT")
    result = value.strip().lower()
    if len(result) > 254 or not _EMAIL.match(result) or _CONTROL.search(result):
        raise TubaraoError("INVALID_INPUT")
    return result


def clean_category(value) -> str:
    if value not in CATEGORIES:
        raise TubaraoError("INVALID_INPUT", "Choose WOMEN or MEN.")
    return value


def _same_person(value_a: str, value_b: str) -> bool:
    """Compare names the forgiving way: ignore case, accents form and extra spaces."""
    def normal(text: str) -> str:
        return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", text).strip()).lower()
    return normal(value_a) == normal(value_b)


# ================================================================ which event is live

def current_event(conn) -> dict:
    """The event the public page, checkout and door all use.

    Rule: among active events, prefer one whose sales are OPEN or SCHEDULED,
    then the newest. If none of those exist, take the newest active event.
    """
    events = db.active_events(conn)  # already newest first
    preferred = [event for event in events if event["sales_mode"] in ("OPEN", "SCHEDULED")]
    chosen = (preferred or events)
    if not chosen:
        raise TubaraoError("EVENT_NOT_FOUND")
    return chosen[0]


# ================================================================ booking status

def claim_deadline(row: dict, event: dict, hold_hours: int | None = None) -> datetime | None:
    claimed = parse_time(row.get("claimed_at"))
    if claimed is None:
        return None
    return claimed + timedelta(hours=hold_hours if hold_hours is not None else event["claim_hold_hours"])


def effective_status(row: dict, event: dict, now: datetime, hold_hours: int | None = None) -> str:
    """The status as it really is right now.

    A RESERVED booking whose hold time has passed is EXPIRED even if nobody has
    saved that yet. The same goes for a claim whose review window has ended.
    """
    status = row["status"]
    if status == "RESERVED" and not parse_time(row["reserved_until"]) > now:
        return "EXPIRED"
    if status == "PAYMENT_CLAIMED":
        deadline = claim_deadline(row, event, hold_hours)
        if deadline is None or not deadline > now:
            return "EXPIRED"
    return status


def occupies_place(row: dict, event: dict, now: datetime, hold_hours: int | None = None) -> bool:
    """PAID tickets and live holds use up a place; everything else does not."""
    return effective_status(row, event, now, hold_hours) in ACTIVE_STATUSES


def occupancy(conn, event: dict, now: datetime, exclude_id: str | None = None,
              hold_hours: int | None = None) -> dict:
    """Count used places. Non-paying guests count toward the physical limit,
    but only paid MEN bookings count toward the MEN cap."""
    rows = [row for row in db.reservations_for_event(conn, event["id"]) if row["id"] != exclude_id]
    live = [row for row in rows if occupies_place(row, event, now, hold_hours)]
    non_paying = len(db.non_paying_for_event(conn, event["id"]))
    return {
        "paid_and_holds": len(live),
        "men": sum(1 for row in live if row["category"] == "MEN"),
        "non_paying": non_paying,
        "total": len(live) + non_paying,
    }


def expiry_moment(row: dict, event: dict) -> str | None:
    """When a hold or claim ran out: the hold deadline, or the end of the claim's review window."""
    if row["status"] == "PAYMENT_CLAIMED":
        deadline = claim_deadline(row, event)
        return to_iso(deadline) if deadline else row["reserved_until"]
    return row["reserved_until"]


def _mark_expired(conn, row: dict, event: dict, now: datetime) -> None:
    db.update(conn, "reservations", row["id"],
              {"status": "EXPIRED", "expired_at": expiry_moment(row, event), "updated_at": to_iso(now)})


def _elapsed(conn, event: dict, now: datetime) -> list[dict]:
    return [row for row in db.reservations_for_event(conn, event["id"])
            if row["status"] in ("RESERVED", "PAYMENT_CLAIMED") and effective_status(row, event, now) == "EXPIRED"]


def expire_elapsed(conn, event: dict, now: datetime) -> None:
    """Save EXPIRED on holds and claims whose time has run out (call inside a transaction)."""
    for row in _elapsed(conn, event, now):
        _mark_expired(conn, row, event, now)


def refresh_expiry(conn, event: dict, now: datetime) -> None:
    """Before reading an event's bookings, save any that have run out as EXPIRED.

    The quick check runs without locking; the database write lock is only taken
    when something actually needs saving, so busy screens don't queue up.
    """
    if _elapsed(conn, event, now):
        with db.transaction(conn):
            expire_elapsed(conn, event, now)


def sales_open(event: dict, now: datetime) -> bool:
    """OPEN ignores the schedule, CLOSED blocks, SCHEDULED follows the opening/closing times.
    The exact closing time itself still counts as open."""
    if not event["is_active"]:
        return False
    if event["sales_mode"] == "OPEN":
        return True
    if event["sales_mode"] != "SCHEDULED":
        return False
    opens = parse_time(event["sales_open_at"])
    closes = parse_time(event["sales_close_at"])
    return opens is not None and opens <= now and (closes is None or closes >= now)


# ================================================================ prices

def event_pricing(event: dict, now: datetime) -> dict:
    """Which price applies to a NEW booking right now.

    AUTO: EARLY until early_price_ends_at, LATE from that moment on
          (no deadline set means EARLY forever).
    EARLY / LATE: the organizer forced one price.
    Existing bookings keep the price they were created with.
    """
    ends = parse_time(event["early_price_ends_at"])
    late = event["pricing_mode"] == "LATE" or (event["pricing_mode"] == "AUTO" and ends is not None and now >= ends)
    phase = "LATE" if late else "EARLY"
    return {
        "phase": phase,
        "current_price_cents": event["late_price_cents"] if late else event["early_price_cents"],
        "next_price_cents": None if late else event["late_price_cents"],
        "early_price_ends_at": event["early_price_ends_at"] if phase == "EARLY" and event["pricing_mode"] == "AUTO" else None,
        "server_now": to_iso(now),
    }


# ================================================================ public page

def public_state(conn, now: datetime) -> dict:
    """Everything the public page may show. Words only: never exact counts."""
    event = current_event(conn)
    refresh_expiry(conn, event, now)
    used = occupancy(conn, event, now)
    remaining = event["physical_capacity"] - used["total"]
    men_remaining = event["men_paid_cap"] - used["men"]
    is_open = sales_open(event, now)

    def label(available: int, threshold: int) -> str:
        if not is_open or available <= 0:
            return "SOLD_OUT"
        return "FEW_TICKETS_LEFT" if available <= threshold else "AVAILABLE"

    if not is_open or remaining <= 0 or men_remaining <= 0:
        men_status = "SOLD_OUT"
    elif remaining <= FEW_TOTAL or men_remaining <= FEW_MEN:
        men_status = "FEW_TICKETS_LEFT"
    else:
        men_status = "AVAILABLE"

    pricing = event_pricing(event, now)
    show_late = bool(event["show_late_price_before_start"])
    return {
        "event_id": event["id"],
        "name": event["name"],
        "starts_at": event["starts_at"],
        "reservation_minutes": event["reservation_minutes"],
        "sales_status": "OPEN" if is_open else "CLOSED",
        "women_status": label(remaining, FEW_TOTAL),
        "men_status": men_status,
        "pricing": {
            **pricing,
            "next_price_cents": pricing["next_price_cents"] if show_late else None,
            "show_countdown": bool(event["show_pricing_countdown"]),
            "show_late_price": show_late,
        },
    }


def reservation_view(row: dict, event: dict, now: datetime) -> dict:
    """What a guest may see about their own booking (no QR, no staff data)."""
    deadline = claim_deadline(row, event)
    return {
        "reservation_id": row["id"],
        "category": row["category"],
        "status": effective_status(row, event, now),
        "amount_cents": row["amount_cents"],
        "list_price_cents": row["list_price_cents"] if row.get("list_price_cents") is not None else row["amount_cents"],
        "promo_code": row.get("promo_code"),
        "pricing_tier": row["pricing_tier"],
        "reserved_until": row["reserved_until"],
        "claimed_at": row["claimed_at"],
        "claim_expires_at": to_iso(deadline) if deadline else None,
    }


# ================================================================ guest actions

def reserve(conn, first_name, last_name, email, category, now: datetime, promo_code: str | None = None,
            expected_event_id: str | None = None) -> dict:
    """Hold a place for a guest, or resume the booking they already have.

    Entering the same name, email and category again returns the existing
    live booking with its original deadline and price (any promo code typed
    then is ignored). A different name or category for the same email is
    refused without saying why. A valid promo code lowers the price of a new
    booking; an invalid one refuses the booking with the reason.
    """
    first_name, last_name = clean_name(first_name), clean_name(last_name)
    email, category = clean_email(email), clean_category(category)

    with db.transaction(conn):
        event = current_event(conn)
        if expected_event_id is not None and event["id"] != expected_event_id:
            raise TubaraoError("EVENT_CHANGED")

        # 1. Resume an existing live booking for this email (works even when sales are closed).
        for row in db.reservations_for_event(conn, event["id"]):
            if row["email"] == email and occupies_place(row, event, now):
                if not (_same_person(row["first_name"], first_name) and _same_person(row["last_name"], last_name)
                        and row["category"] == category):
                    raise TubaraoError("ACTIVE_RESERVATION_EXISTS")
                return {**reservation_view(row, event, now), "resumed": True}

        # 2. Otherwise create a new hold, checking every rule under the write lock.
        expire_elapsed(conn, event, now)
        if not sales_open(event, now):
            raise TubaraoError("SALES_CLOSED")
        used = occupancy(conn, event, now)
        if used["total"] >= event["physical_capacity"]:
            raise TubaraoError("EVENT_SOLD_OUT")
        if category == "MEN" and used["men"] >= event["men_paid_cap"]:
            raise TubaraoError("MEN_SOLD_OUT")

        pricing = event_pricing(event, now)
        list_price = pricing["current_price_cents"]
        code = usable_promo_code(conn, event, promo_code, now)  # None when no code was typed
        row = {
            "id": _new_id(), "event_id": event["id"],
            "first_name": first_name, "last_name": last_name, "email": email, "category": category,
            "amount_cents": discounted_price(list_price, code["percent_off"]) if code else list_price,
            "list_price_cents": list_price,
            "promo_code_id": code["id"] if code else None, "promo_code": code["code"] if code else None,
            "pricing_tier": pricing["phase"],
            "status": "RESERVED",
            "reserved_until": to_iso(now + timedelta(minutes=event["reservation_minutes"])),
            "created_at": to_iso(now), "updated_at": to_iso(now),
        }
        try:
            db.insert(conn, "reservations", row)
        except Exception as error:  # the one-live-booking-per-email index
            if "UNIQUE" in str(error):
                raise TubaraoError("ACTIVE_RESERVATION_EXISTS") from error
            raise
        return {**reservation_view(db.get_reservation(conn, row["id"]), event, now), "resumed": False}


# ================================================================ promo codes

PROMO_PATTERN = re.compile(r"^[A-Z0-9-]{3,20}$")


def discounted_price(cents: int, percent_off: int) -> int:
    """Price after a percent discount, rounded to the nearest cent (half a cent rounds up), never below 1 cent."""
    return max(1, (cents * (100 - percent_off) + 50) // 100)


def promo_uses(conn, event: dict, code_id: str, now: datetime) -> int:
    """Uses taken = bookings with this code that still hold a place (live hold, live claim or PAID)."""
    return sum(1 for row in db.reservations_for_event(conn, event["id"])
               if row["promo_code_id"] == code_id and occupies_place(row, event, now))


def usable_promo_code(conn, event: dict, typed, now: datetime) -> dict | None:
    """The promo code a guest typed, if it can be used right now. Empty means no code.
    Otherwise it raises the reason: doesn't exist, inactive, expired or fully used."""
    if typed is None or not str(typed).strip():
        return None
    code = db.promo_code_by_code(conn, event["id"], str(typed).strip().upper())
    if code is None:
        raise TubaraoError("PROMO_CODE_NOT_FOUND")
    if not code["is_active"]:
        raise TubaraoError("PROMO_CODE_INACTIVE")
    if code["expires_at"] and now >= parse_time(code["expires_at"]):
        raise TubaraoError("PROMO_CODE_EXPIRED")
    if code["max_uses"] is not None and promo_uses(conn, event, code["id"], now) >= code["max_uses"]:
        raise TubaraoError("PROMO_CODE_USED_UP")
    return code


def create_promo_code(conn, admin, event_id, code, percent_off, max_uses, expires_at, now: datetime) -> dict:
    """Organizer: a new discount code for the active event. Saved in capitals, unique within the event."""
    require_role(conn, admin)
    text = code.strip().upper() if isinstance(code, str) else ""
    whole = lambda value: isinstance(value, int) and not isinstance(value, bool)  # noqa: E731
    if (not PROMO_PATTERN.match(text) or not whole(percent_off) or not 1 <= percent_off <= 90
            or (max_uses is not None and (not whole(max_uses) or max_uses < 1))):
        raise TubaraoError("INVALID_PROMO_CODE")
    try:
        expires = to_iso(expires_at)
    except TubaraoError as error:
        raise TubaraoError("INVALID_PROMO_CODE") from error
    with db.transaction(conn):
        if current_event(conn)["id"] != event_id:
            raise TubaraoError("EVENT_CHANGED")
        if db.promo_code_by_code(conn, event_id, text):
            raise TubaraoError("PROMO_CODE_EXISTS")
        row = {"id": _new_id(), "event_id": event_id, "code": text, "percent_off": percent_off,
               "max_uses": max_uses, "expires_at": expires, "is_active": 1,
               "created_at": to_iso(now), "updated_at": to_iso(now)}
        db.insert(conn, "promo_codes", row)
    return db.get_promo_code(conn, row["id"])


def set_promo_code_active(conn, admin, code_id, active: bool, now: datetime) -> dict:
    """Organizer: switch a code off or on. Codes are never deleted, so bookings keep their history."""
    require_role(conn, admin)
    with db.transaction(conn):
        code = db.get_promo_code(conn, code_id) if isinstance(code_id, str) else None
        if code is None or code["event_id"] != current_event(conn)["id"]:
            raise TubaraoError("PROMO_CODE_NOT_FOUND")
        db.update(conn, "promo_codes", code["id"], {"is_active": int(bool(active)), "updated_at": to_iso(now)})
    return db.get_promo_code(conn, code_id)


def promo_codes(conn, admin, now: datetime) -> list[dict]:
    """Organizer: every code of the active event, with the uses taken right now."""
    require_role(conn, admin)
    event = current_event(conn)
    return [{**code, "uses": promo_uses(conn, event, code["id"], now)}
            for code in db.promo_codes_for_event(conn, event["id"])]


def _owned(conn, reservation_id, email) -> dict:
    """Find a booking by its reference AND the guest's email (both must match)."""
    if not isinstance(reservation_id, str) or not tickets.UUID_PATTERN.match(reservation_id.strip()):
        raise TubaraoError("RESERVATION_NOT_FOUND")
    row = db.get_reservation(conn, reservation_id.strip().lower())
    try:
        email = clean_email(email)
    except TubaraoError:
        raise TubaraoError("RESERVATION_NOT_FOUND")
    if row is None or row["email"] != email:
        raise TubaraoError("RESERVATION_NOT_FOUND")
    return row


def reservation_state(conn, reservation_id, email, now: datetime) -> dict:
    """Read-only: let a guest see the current status of their booking."""
    row = _owned(conn, reservation_id, email)
    return _fresh_view(conn, row, now)


def _fresh_view(conn, row: dict, now: datetime) -> dict:
    """The guest's view of one booking, after saving EXPIRED if its time has run out."""
    event = db.get_event(conn, row["event_id"])
    if row["status"] in ("RESERVED", "PAYMENT_CLAIMED") and effective_status(row, event, now) == "EXPIRED":
        with db.transaction(conn):
            current = db.get_reservation(conn, row["id"])
            if current["status"] == row["status"]:  # nobody changed it in the meantime
                _mark_expired(conn, current, event, now)
        row = db.get_reservation(conn, row["id"])
    return reservation_view(row, event, now)


def booking_by_reference(conn, reference, now: datetime) -> dict:
    """Reopen a booking from the link in the page address (?booking=<reference>).

    The reference is a long random ID that nobody can guess, and the view it
    returns has no name or email in it. Claiming the payment still needs the
    email (see claim_payment), so a shared link cannot be used to claim.
    """
    if not isinstance(reference, str) or not tickets.UUID_PATTERN.match(reference.strip()):
        raise TubaraoError("RESERVATION_NOT_FOUND")
    row = db.get_reservation(conn, reference.strip().lower())
    if row is None:
        raise TubaraoError("RESERVATION_NOT_FOUND")
    return _fresh_view(conn, row, now)


def claim_payment(conn, reservation_id, email, now: datetime) -> dict:
    """The guest says "I've paid" (simulated in the classroom demo).

    This is only a claim. It stops the 20-minute timer and protects the place
    for the event's review window, but it is NOT a ticket: an organizer must
    still confirm the payment.
    """
    with db.transaction(conn):
        row = _owned(conn, reservation_id, email)
        event = db.get_event(conn, row["event_id"])
        if not event or not event["is_active"]:
            raise TubaraoError("EVENT_CHANGED")
        if row["status"] == "PAYMENT_CLAIMED":  # pressing twice is harmless
            return reservation_view(row, event, now)
        if row["status"] != "RESERVED":
            raise TubaraoError("INVALID_RESERVATION_STATUS")
        if effective_status(row, event, now) == "EXPIRED":
            _mark_expired(conn, row, event, now)
            raise TubaraoError("INVALID_RESERVATION_STATUS")
        db.update(conn, "reservations", row["id"],
                  {"status": "PAYMENT_CLAIMED", "claimed_at": to_iso(now), "updated_at": to_iso(now)})
        return reservation_view(db.get_reservation(conn, row["id"]), event, now)


# ================================================================ staff access codes and sessions

def hash_access_code(code: str, salt_hex: str) -> str:
    """Slow, salted fingerprint of an access code (scrypt), as in the original app."""
    digest = hashlib.scrypt(code.encode("utf-8"), salt=bytes.fromhex(salt_hex),
                            n=16384, r=8, p=1, maxmem=64 * 1024 * 1024, dklen=32)
    return digest.hex()


def create_access_account(conn, label: str, role: str, code: str) -> str:
    """Add a staff account. Only the salted hash of the code is stored."""
    if role not in ROLES:
        raise TubaraoError("INVALID_INPUT", "Role must be ADMIN or SUPER_ADMIN.")
    code = (code or "").strip()
    if len(code) < MIN_CODE_LENGTH:
        raise TubaraoError("INVALID_INPUT", f"Access codes need at least {MIN_CODE_LENGTH} characters.")
    label = clean_name(label)
    with db.transaction(conn):
        if _code_taken(conn, code):
            raise TubaraoError("CODE_IN_USE")
        salt = secrets.token_hex(16)
        account_id = _new_id()
        db.insert(conn, "admin_access_accounts", {
            "id": account_id, "label": label, "role": role,
            "code_salt": salt, "code_hash": hash_access_code(code, salt), "is_active": 1,
        })
    return account_id


def _code_taken(conn, code: str, except_id: str | None = None) -> bool:
    """Is this code already used by another account, active or not?

    Sign-in finds an account by its code alone, so two active accounts must never share one.
    Deactivated accounts count too: only a fingerprint of each code is stored, so when an
    account is activated again we could not tell whether its old code was reused meanwhile.
    """
    accounts = db.fetch_all(conn, "SELECT id, code_salt, code_hash FROM admin_access_accounts")
    return any(hmac.compare_digest(hash_access_code(code, account["code_salt"]), account["code_hash"])
               for account in accounts if account["id"] != except_id)


def _clean_code(code) -> str:
    code = code.strip() if isinstance(code, str) else ""
    if not MIN_CODE_LENGTH <= len(code) <= 512:
        raise TubaraoError("INVALID_INPUT", f"Access codes need at least {MIN_CODE_LENGTH} characters.")
    return code


def _revoke_sessions(conn, account_id: str, now: datetime) -> None:
    conn.execute("UPDATE admin_sessions SET revoked_at = ? WHERE account_id = ? AND revoked_at IS NULL",
                 (to_iso(now), account_id))


def staff_accounts(conn, admin) -> list[dict]:
    """Organizer: every staff account, without codes or their hashes."""
    require_role(conn, admin)
    rows = db.fetch_all(conn, "SELECT id, label, role, is_active, last_login_at FROM admin_access_accounts "
                              "ORDER BY role DESC, label")
    return rows


def add_staff_account(conn, admin, label, role, code, now: datetime) -> str:
    """Organizer: a new door (ADMIN) or organizer (SUPER_ADMIN) account. Returns its ID."""
    require_role(conn, admin)
    return create_access_account(conn, label, role, _clean_code(code))


def _staff_row(conn, account_id) -> dict:
    account = db.get_account(conn, account_id) if isinstance(account_id, str) else None
    if account is None:
        raise TubaraoError("STAFF_NOT_FOUND")
    return account


def set_staff_active(conn, admin, account_id, active: bool, now: datetime) -> dict:
    """Organizer: switch an account off (signed out at once) or back on (with its old code)."""
    admin = require_role(conn, admin)
    with db.transaction(conn):
        account = _staff_row(conn, account_id)
        if not active:
            if account["id"] == admin["account_id"]:
                raise TubaraoError("CANNOT_CHANGE_SELF")
            db.update(conn, "admin_access_accounts", account["id"], {"is_active": 0})
            _revoke_sessions(conn, account["id"], now)
        else:  # safe: no other account can have been given this account's code (see _code_taken)
            db.update(conn, "admin_access_accounts", account["id"], {"is_active": 1})
    return {"account_id": account_id, "is_active": bool(active)}


def reset_staff_code(conn, admin, account_id, new_code, now: datetime) -> dict:
    """Organizer: give an account a new code. The old code stops working and the account is signed out."""
    require_role(conn, admin)
    code = _clean_code(new_code)
    with db.transaction(conn):
        account = _staff_row(conn, account_id)
        if _code_taken(conn, code, except_id=account["id"]):
            raise TubaraoError("CODE_IN_USE")
        salt = secrets.token_hex(16)
        db.update(conn, "admin_access_accounts", account["id"],
                  {"code_salt": salt, "code_hash": hash_access_code(code, salt)})
        _revoke_sessions(conn, account["id"], now)
    return {"account_id": account_id, "reset": True}


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _source_hash(source) -> str:
    return hashlib.sha256(f"tubarao-login-source:{source or 'unknown'}".encode("utf-8")).hexdigest()


def _locked(conn, source_hash: str, now: datetime) -> bool:
    """Locked = 5 wrong codes within 15 minutes, and less than 15 minutes since the 5th of them."""
    since = to_iso(now - 2 * LOGIN_FAILURE_WINDOW)
    times = [parse_time(row["failed_at"]) for row in db.fetch_all(
        conn, "SELECT failed_at FROM login_failures WHERE source_hash = ? AND failed_at > ? ORDER BY failed_at",
        (source_hash, since))]
    n = LOGIN_FAILURE_LIMIT
    return any(times[i + n - 1] - times[i] <= LOGIN_FAILURE_WINDOW and now - times[i + n - 1] < LOGIN_FAILURE_WINDOW
               for i in range(len(times) - n + 1))


def login(conn, code, now: datetime, source: str | None = None) -> tuple[str, dict]:
    """Check an access code and start a 12-hour session.

    Returns (session_token, identity). The token is kept by the browser
    session; the database stores only its hash.

    `source` is who is trying (the screen passes the visitor's IP address, or its
    browser session). After 5 wrong codes from one source within 15 minutes, that
    source is refused, even with the right code, until 15 minutes after its 5th
    failure. Other sources are unaffected, so nobody can lock real staff out.
    """
    source_hash = _source_hash(source)
    with db.transaction(conn):
        if _locked(conn, source_hash, now):
            raise TubaraoError("TOO_MANY_ATTEMPTS")
    try:
        return _check_code(conn, code, now, source_hash)
    except TubaraoError as error:
        if error.code == "INVALID_ACCESS_CODE":
            with db.transaction(conn):
                db.insert(conn, "login_failures", {"source_hash": source_hash, "failed_at": to_iso(now)})
                conn.execute("DELETE FROM login_failures WHERE failed_at < ?", (to_iso(now - timedelta(days=1)),))
        raise


def _check_code(conn, code, now: datetime, source_hash: str) -> tuple[str, dict]:
    if not isinstance(code, str) or not code.strip() or len(code) > 512:
        raise TubaraoError("INVALID_ACCESS_CODE")
    code = code.strip()
    with db.transaction(conn):
        # Check every account so a wrong code never reveals which account exists.
        matches = [account for account in db.active_accounts(conn)
                   if hmac.compare_digest(hash_access_code(code, account["code_salt"]), account["code_hash"])]
        if len(matches) != 1:
            raise TubaraoError("INVALID_ACCESS_CODE")
        account = matches[0]
        token = secrets.token_urlsafe(32)
        db.update(conn, "admin_access_accounts", account["id"], {"last_login_at": to_iso(now)})
        db.insert(conn, "admin_sessions", {
            "id": _new_id(), "account_id": account["id"], "session_token_hash": _token_hash(token),
            "created_at": to_iso(now), "last_seen_at": to_iso(now),
            "expires_at": to_iso(now + timedelta(hours=SESSION_HOURS)),
        })
        conn.execute("DELETE FROM login_failures WHERE source_hash = ?", (source_hash,))  # success clears the count
    return token, {"account_id": account["id"], "label": account["label"], "role": account["role"]}


def session_identity(conn, token: str | None, now: datetime) -> dict | None:
    """Who is signed in with this token, or None if the session is not valid."""
    if not token:
        return None
    session = db.session_by_token_hash(conn, _token_hash(token))
    if session is None or session["revoked_at"] or not parse_time(session["expires_at"]) > now:
        return None
    account = db.get_account(conn, session["account_id"])
    if account is None or not account["is_active"] or account["role"] not in ROLES:
        return None
    last_seen = parse_time(session["last_seen_at"])
    if last_seen is None or last_seen < now - timedelta(minutes=15):
        with db.transaction(conn):
            db.update(conn, "admin_sessions", session["id"], {"last_seen_at": to_iso(now)})
    return {"account_id": account["id"], "label": account["label"], "role": account["role"], "session_token": token}


def logout(conn, token: str | None, now: datetime) -> None:
    if not token:
        return
    session = db.session_by_token_hash(conn, _token_hash(token))
    if session and not session["revoked_at"]:
        with db.transaction(conn):
            db.update(conn, "admin_sessions", session["id"], {"revoked_at": to_iso(now)})


def require_role(conn, admin: dict | None, roles=("SUPER_ADMIN",)) -> dict:
    """Check the staff member against the database every time, never trusting the screen.
    SUPER_ADMIN = organizer (everything). ADMIN = door staff (check-in only).

    The screens always pass the identity with its session token, and the session is checked
    here on every action: it must exist, not be revoked or expired, and belong to this account.
    So a popup or a live panel left open after LOG OUT (or after the session ends) can't act.
    (Identities without a token are only made inside the code: seed.py and the tests.)
    """
    if not admin or "account_id" not in admin:
        raise TubaraoError("UNAUTHORIZED")
    if "session_token" in admin:
        session = db.session_by_token_hash(conn, _token_hash(str(admin["session_token"])))
        if (session is None or session["revoked_at"] or session["account_id"] != admin["account_id"]
                or not parse_time(session["expires_at"]) > utcnow()):
            raise TubaraoError("UNAUTHORIZED")
    account = db.get_account(conn, admin["account_id"])
    if account is None or not account["is_active"]:
        raise TubaraoError("UNAUTHORIZED")
    if account["role"] not in roles:
        raise TubaraoError("FORBIDDEN")
    identity = {"account_id": account["id"], "label": account["label"], "role": account["role"]}
    if "session_token" in admin:
        identity["session_token"] = admin["session_token"]
    return identity


def _current_event_row(conn, reservation_id: str) -> tuple[dict, dict]:
    """Organizer actions only apply to bookings of the active event."""
    row = db.get_reservation(conn, reservation_id) if isinstance(reservation_id, str) else None
    if row is None:
        raise TubaraoError("RESERVATION_NOT_FOUND", "Reservation not found. Refresh the dashboard.")
    event = current_event(conn)
    if row["event_id"] != event["id"]:
        raise TubaraoError("EVENT_CHANGED")
    return row, event


# ================================================================ payments and tickets (organizer)

def confirm_payment(conn, admin, reservation_id, now: datetime, secret: str) -> dict:
    """Organizer confirms a PAYMENT_CLAIMED booking after checking the money arrived.

    Becomes PAID and a demo QR ticket is issued. If the review window already
    ended, the booking becomes EXPIRED instead.
    """
    admin = require_role(conn, admin)
    with db.transaction(conn):
        row, event = _current_event_row(conn, reservation_id)
        if row["status"] == "PAID":
            result = {"reservation_id": row["id"], "status": "PAID"}
        elif row["status"] != "PAYMENT_CLAIMED":
            raise TubaraoError("PAYMENT_NOT_CLAIMED")
        elif effective_status(row, event, now) == "EXPIRED":
            _mark_expired(conn, row, event, now)
            return {"reservation_id": row["id"], "status": "EXPIRED"}
        else:
            _mark_paid(conn, row, admin, now)
            result = {"reservation_id": row["id"], "status": "PAID"}
    return {**result, **issue_ticket(conn, row["id"], now, secret)}


def confirm_external_payment(conn, admin, reservation_id, now: datetime, secret: str) -> dict:
    """Recovery: the organizer saw the money in Revolut but the guest never pressed
    "I've paid", or the hold expired. RESERVED and EXPIRED bookings can become PAID,
    but an expired one must win its place back (capacity is checked again).
    REJECTED and CANCELLED bookings cannot be restored."""
    admin = require_role(conn, admin)
    with db.transaction(conn):
        row, event = _current_event_row(conn, reservation_id)
        expire_elapsed(conn, event, now)
        if row["status"] == "PAYMENT_CLAIMED" and effective_status(row, event, now) == "EXPIRED":
            return {"reservation_id": row["id"], "status": "EXPIRED"}
        if row["status"] in ("PAYMENT_CLAIMED", "PAID"):
            if row["status"] == "PAYMENT_CLAIMED":
                _mark_paid(conn, row, admin, now)
        elif row["status"] in ("RESERVED", "EXPIRED"):
            used = occupancy(conn, event, now, exclude_id=row["id"])
            if used["total"] >= event["physical_capacity"]:
                raise TubaraoError("EVENT_SOLD_OUT")
            if row["category"] == "MEN" and used["men"] >= event["men_paid_cap"]:
                raise TubaraoError("MEN_SOLD_OUT")
            try:
                _mark_paid(conn, row, admin, now)
            except Exception as error:
                if "UNIQUE" in str(error):  # this email already has another live booking
                    raise TubaraoError("ACTIVE_RESERVATION_EXISTS") from error
                raise
        else:
            raise TubaraoError("INVALID_RESERVATION_STATUS", "Rejected or cancelled bookings cannot be confirmed.")
    return {"reservation_id": row["id"], "status": "PAID", **issue_ticket(conn, row["id"], now, secret)}


def _mark_paid(conn, row: dict, admin: dict, now: datetime) -> None:
    values = {"status": "PAID", "paid_at": to_iso(now), "updated_at": to_iso(now)}
    if not row["confirmed_by_access_id"]:  # keep the first confirmer on retries
        values["confirmed_by_access_id"] = admin["account_id"]
    db.update(conn, "reservations", row["id"], values)


def reject_payment(conn, admin, reservation_id, now: datetime) -> dict:
    """Organizer could not find the payment: the claim is rejected and the place freed."""
    require_role(conn, admin)
    with db.transaction(conn):
        row, _event = _current_event_row(conn, reservation_id)
        if row["status"] == "REJECTED":
            return {"reservation_id": row["id"], "status": "REJECTED"}
        if row["status"] != "PAYMENT_CLAIMED":
            raise TubaraoError("PAYMENT_NOT_CLAIMED")
        db.update(conn, "reservations", row["id"],
                  {"status": "REJECTED", "rejected_at": to_iso(now), "updated_at": to_iso(now)})
    return {"reservation_id": row["id"], "status": "REJECTED"}


def issue_ticket(conn, reservation_id: str, now: datetime, secret: str, retry: bool = False) -> dict:
    """Create the demo QR ticket for a PAID booking (stands in for the ticket email).

    Automatic issuing is tried once. If it fails the booking stays PAID and the
    organizer can press RETRY TICKET, which reproduces exactly the same QR.
    """
    with db.transaction(conn):
        row = db.get_reservation(conn, reservation_id)
        if row is None:
            raise TubaraoError("RESERVATION_NOT_FOUND")
        if row["status"] != "PAID":
            raise TubaraoError("PAYMENT_NOT_CONFIRMED")
        if not retry and (row["ticket_issued_at"] or row["ticket_issue_attempts"] > 0):
            return _ticket_result(row)
        error, values = None, {"ticket_issue_attempts": row["ticket_issue_attempts"] + 1}
        try:
            token = tickets.derive_ticket_token(row["id"], row["event_id"], secret)
            if row["qr_token_hash"] and not tickets.matches_token_hash(token, row["qr_token_hash"]):
                error = TICKET_MISMATCH
                raise ValueError("hash mismatch")
            tickets.qr_png(token)  # make sure the image can be drawn
            values.update({
                "qr_token_hash": row["qr_token_hash"] or tickets.hash_ticket_token(token),
                "qr_created_at": row["qr_created_at"] or to_iso(now),
                "ticket_issued_at": to_iso(now), "ticket_issue_error": None,
            })
        except Exception:
            values["ticket_issue_error"] = error or TICKET_FAILED
        db.update(conn, "reservations", row["id"], values)
        return _ticket_result(db.get_reservation(conn, row["id"]))


def _ticket_result(row: dict) -> dict:
    return {"ticket_issued": bool(row["ticket_issued_at"]), "ticket_error": row["ticket_issue_error"]}


def retry_ticket(conn, admin, reservation_id, now: datetime, secret: str) -> dict:
    require_role(conn, admin)
    _current_event_row(conn, reservation_id)
    return {"reservation_id": reservation_id, "status": "PAID",
            **issue_ticket(conn, reservation_id, now, secret, retry=True)}


def ticket_qr(conn, admin, reservation_id, secret: str) -> bytes:
    """Download the PNG QR of an issued ticket (organizer only, active event only)."""
    require_role(conn, admin)
    row, _event = _current_event_row(conn, reservation_id)
    if row["status"] != "PAID":
        raise TubaraoError("PAYMENT_NOT_CONFIRMED")
    if not row["ticket_issued_at"]:
        raise TubaraoError("TICKET_NOT_FOUND")
    token = tickets.derive_ticket_token(row["id"], row["event_id"], secret)
    if not tickets.matches_token_hash(token, row["qr_token_hash"]):
        raise TubaraoError("TICKET_HASH_MISMATCH")
    return tickets.qr_png(token)


# ================================================================ corrections (organizer)

_TICKET_EVIDENCE = ("paid_at", "checked_in_at", "qr_token_hash", "qr_created_at", "ticket_issued_at")


def can_delete_record(row: dict) -> bool:
    """Only bookings that never turned into money or a ticket can be deleted."""
    return row["status"] in ("RESERVED", "REJECTED", "EXPIRED") and all(row[field] is None for field in _TICKET_EVIDENCE)


def delete_record(conn, admin, reservation_id) -> dict:
    require_role(conn, admin)
    with db.transaction(conn):
        row = db.get_reservation(conn, reservation_id)
        if row is None:
            raise TubaraoError("RESERVATION_NOT_FOUND", "Reservation not found. Refresh the dashboard.")
        if not can_delete_record(row):
            raise TubaraoError("RESERVATION_NOT_DELETABLE")
        db.delete_reservation_row(conn, row["id"])
    return {"reservation_id": reservation_id, "deleted": True}


def delete_paid_ticket(conn, admin, reservation_id) -> dict:
    """Remove an accidentally confirmed duplicate: PAID and not yet checked in.
    The QR stops working and the place is released. Permanent."""
    require_role(conn, admin)
    with db.transaction(conn):
        row = db.get_reservation(conn, reservation_id)
        if row is None or row["status"] != "PAID" or row["checked_in_at"] is not None:
            raise TubaraoError("PAID_TICKET_NOT_DELETABLE")
        db.delete_reservation_row(conn, row["id"])
    return {"reservation_id": reservation_id, "deleted": True}


def change_paid_category(conn, admin, reservation_id, category, now: datetime) -> dict:
    """Fix a ticket bought under the wrong category. Price and QR stay the same."""
    require_role(conn, admin)
    if category not in CATEGORIES:
        raise TubaraoError("INVALID_INPUT", "Choose MEN or WOMEN.")
    with db.transaction(conn):
        row = db.get_reservation(conn, reservation_id)
        if row is None:
            raise TubaraoError("RESERVATION_NOT_FOUND", "Reservation not found. Refresh the dashboard.")
        event = db.get_event(conn, row["event_id"])
        if row["status"] != "PAID" or row["checked_in_at"] is not None:
            raise TubaraoError("CATEGORY_NOT_EDITABLE")
        if row["category"] == category:
            return {"reservation_id": row["id"], "category": category, "changed": False}
        if category == "MEN" and occupancy(conn, event, now)["men"] >= event["men_paid_cap"]:
            raise TubaraoError("MEN_TICKETS_FULL")
        db.update(conn, "reservations", row["id"], {"category": category, "updated_at": to_iso(now)})
    return {"reservation_id": row["id"], "category": category, "changed": True}


def adjust_amount(conn, admin, reservation_id, amount_cents, now: datetime) -> dict:
    """Correct the expected amount of one booking. No money moves.
    The previous and new amounts are recorded in a private history."""
    admin = require_role(conn, admin)
    if isinstance(amount_cents, bool) or not isinstance(amount_cents, int) or not 1 <= amount_cents <= MAX_PRICE_CENTS:
        raise TubaraoError("INVALID_AMOUNT")
    with db.transaction(conn):
        row = db.get_reservation(conn, reservation_id)
        if row is None:
            raise TubaraoError("RESERVATION_NOT_FOUND", "Reservation not found. Refresh the dashboard.")
        if row["status"] not in ACTIVE_STATUSES:
            raise TubaraoError("AMOUNT_NOT_EDITABLE")
        if row["amount_cents"] == amount_cents:
            return {"reservation_id": row["id"], "amount_cents": amount_cents, "changed": False}
        db.insert(conn, "reservation_amount_adjustments", {
            "id": _new_id(), "reservation_id": row["id"],
            "previous_amount_cents": row["amount_cents"], "new_amount_cents": amount_cents,
            "adjusted_at": to_iso(now), "adjusted_by_access_id": admin["account_id"],
        })
        db.update(conn, "reservations", row["id"], {"amount_cents": amount_cents, "updated_at": to_iso(now)})
    return {"reservation_id": row["id"], "amount_cents": amount_cents, "changed": True}


def euros_to_cents(text) -> int:
    """Turn "8", "8.5" or "8,50" into 850 cents. At most two decimals."""
    value = str(text).strip().replace("€", "").replace(",", ".")
    if not re.fullmatch(r"\d{1,4}(\.\d{1,2})?", value):
        raise TubaraoError("INVALID_AMOUNT")
    whole, _, fraction = value.partition(".")
    cents = int(whole) * 100 + int((fraction + "00")[:2])
    if not 1 <= cents <= MAX_PRICE_CENTS:
        raise TubaraoError("INVALID_AMOUNT")
    return cents


# ================================================================ events (organizer)

EVENT_FIELDS = (
    "name", "starts_at", "physical_capacity", "men_paid_cap", "early_price_cents", "late_price_cents",
    "early_price_ends_at", "pricing_mode", "show_pricing_countdown", "show_late_price_before_start",
    "reservation_minutes", "claim_hold_hours", "sales_mode", "sales_open_at", "sales_close_at",
)
EVENT_DEFAULTS = {
    "starts_at": None, "physical_capacity": 120, "men_paid_cap": 45,
    "early_price_cents": 800, "late_price_cents": 1200, "early_price_ends_at": None,
    "pricing_mode": "AUTO", "show_pricing_countdown": False, "show_late_price_before_start": False,
    "reservation_minutes": 15, "claim_hold_hours": 24, "sales_mode": "CLOSED",
    "sales_open_at": None, "sales_close_at": None,
}


def validate_event(values: dict) -> dict:
    """Check event settings and return them cleaned up, ready to save."""
    unknown = set(values) - set(EVENT_FIELDS)
    if unknown:
        raise TubaraoError("INVALID_EVENT", "Unknown event setting.")
    event = dict(values)

    name = event.get("name")
    if not isinstance(name, str) or not name.strip() or len(name.strip()) > 120 or _CONTROL.search(name):
        raise TubaraoError("INVALID_EVENT", "Enter an event name up to 120 characters.")
    event["name"] = name.strip()

    for key, minimum in (("physical_capacity", 1), ("men_paid_cap", 0), ("reservation_minutes", 1), ("claim_hold_hours", 1)):
        value = event.get(key)
        if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= 2_147_483_647:
            raise TubaraoError("INVALID_EVENT", "Check the numeric event settings.")
    for key in ("early_price_cents", "late_price_cents"):
        value = event.get(key)
        if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= MAX_PRICE_CENTS:
            raise TubaraoError("INVALID_EVENT", "Ticket prices must be between €0.01 and €1,000.00.")
    if event.get("pricing_mode") not in ("AUTO", "EARLY", "LATE"):
        raise TubaraoError("INVALID_EVENT", "Choose AUTO, EARLY or LATE pricing.")
    if event["men_paid_cap"] > event["physical_capacity"]:
        raise TubaraoError("INVALID_EVENT", "MEN paid cap cannot exceed physical capacity.")
    if event.get("sales_mode") not in ("OPEN", "CLOSED", "SCHEDULED"):
        raise TubaraoError("INVALID_EVENT", "Choose OPEN, CLOSED or SCHEDULED.")
    for key in ("show_pricing_countdown", "show_late_price_before_start"):
        if not isinstance(event.get(key), bool):
            raise TubaraoError("INVALID_EVENT", "Display settings must be on or off.")
    for key in ("starts_at", "sales_open_at", "sales_close_at", "early_price_ends_at"):
        try:
            event[key] = to_iso(event.get(key))
        except TubaraoError as error:
            raise TubaraoError("INVALID_EVENT", "Use valid date/time values with a time zone.") from error
    if event["sales_mode"] == "SCHEDULED" and not event["sales_open_at"]:
        raise TubaraoError("INVALID_EVENT", "Scheduled sales require an opening time.")
    if event["sales_open_at"] and event["sales_close_at"] and parse_time(event["sales_close_at"]) <= parse_time(event["sales_open_at"]):
        raise TubaraoError("INVALID_EVENT", "Sales closing time must be after opening time.")
    return event


def _event_row_values(event: dict) -> dict:
    values = {key: event[key] for key in EVENT_FIELDS}
    values["show_pricing_countdown"] = int(values["show_pricing_countdown"])
    values["show_late_price_before_start"] = int(values["show_late_price_before_start"])
    return values


def _as_settings(row: dict) -> dict:
    """An event row turned back into editable settings."""
    settings = {key: row[key] for key in EVENT_FIELDS}
    settings["show_pricing_countdown"] = bool(settings["show_pricing_countdown"])
    settings["show_late_price_before_start"] = bool(settings["show_late_price_before_start"])
    return settings


def create_event(conn, admin, values: dict, now: datetime) -> dict:
    """New events start INACTIVE so nothing changes for guests until the organizer activates it."""
    require_role(conn, admin)
    event = validate_event({**EVENT_DEFAULTS, **values})
    row = {"id": _new_id(), **_event_row_values(event), "is_active": 0,
           "created_at": to_iso(now), "updated_at": to_iso(now)}
    with db.transaction(conn):
        db.insert(conn, "events", row)
    return db.get_event(conn, row["id"])


def update_event(conn, admin, event_id: str, changes: dict, now: datetime) -> dict:
    """Edit the active event. Capacity and the MEN cap can never drop below what is
    already taken. A shorter review window still counts claims under the longer one,
    so shortening it cannot squeeze people out."""
    require_role(conn, admin)
    with db.transaction(conn):
        current = current_event(conn)
        if current["id"] != event_id:
            raise TubaraoError("EVENT_CHANGED")
        new = validate_event({**_as_settings(current), **changes})
        used = occupancy(conn, current, now, hold_hours=max(current["claim_hold_hours"], new["claim_hold_hours"]))
        if new["physical_capacity"] < used["total"]:
            raise TubaraoError("CAPACITY_TOO_LOW")
        if new["men_paid_cap"] < used["men"]:
            raise TubaraoError("MEN_CAP_TOO_LOW")
        db.update(conn, "events", current["id"], {**_event_row_values(new), "updated_at": to_iso(now)})
    return db.get_event(conn, event_id)


def activate_event(conn, admin, event_id: str, now: datetime) -> dict:
    """Make one event the live one. All others become inactive; nothing is deleted or moved."""
    require_role(conn, admin)
    with db.transaction(conn):
        if db.get_event(conn, event_id) is None:
            raise TubaraoError("EVENT_NOT_FOUND", "Event not found.")
        conn.execute("UPDATE events SET is_active = 0, updated_at = ? WHERE is_active = 1 AND id <> ?", (to_iso(now), event_id))
        db.update(conn, "events", event_id, {"is_active": 1, "updated_at": to_iso(now)})
    return db.get_event(conn, event_id)


def list_events(conn, admin) -> list[dict]:
    require_role(conn, admin)
    return db.all_events(conn)


# ================================================================ non-paying attendees (organizer)

def add_non_paying(conn, admin, event_id, first_name, last_name, category, email, now: datetime) -> dict:
    """Residents and invited guests: they take a physical place but pay nothing."""
    require_role(conn, admin)
    first_name, last_name = clean_name(first_name), clean_name(last_name)
    category = clean_category(category)
    email = None if not email or not str(email).strip() else clean_email(email)
    with db.transaction(conn):
        event = current_event(conn)
        if event["id"] != event_id:
            raise TubaraoError("EVENT_CHANGED")
        if occupancy(conn, event, now)["total"] >= event["physical_capacity"]:
            raise TubaraoError("EVENT_FULL")
        row = {"id": _new_id(), "event_id": event["id"], "first_name": first_name, "last_name": last_name,
               "email": email, "category": category, "created_at": to_iso(now)}
        db.insert(conn, "non_paying_attendees", row)
    return row


def remove_non_paying(conn, admin, event_id, attendee_id) -> dict:
    require_role(conn, admin)
    with db.transaction(conn):
        event = current_event(conn)
        if event["id"] != event_id:
            raise TubaraoError("EVENT_CHANGED")
        attendee = db.get_non_paying(conn, attendee_id)
        if attendee is None or attendee["event_id"] != event["id"]:
            raise TubaraoError("ATTENDEE_NOT_FOUND")
        db.delete_non_paying_row(conn, attendee_id)
    return {"removed": True}


# ================================================================ the door (door staff and organizer)

DOOR_ROLES = ("ADMIN", "SUPER_ADMIN")


def _check_in(conn, admin: dict, row: dict | None, now: datetime) -> dict:
    """Single-use admission. Inside one transaction, so two phones scanning the
    same ticket at once cannot both let the guest in."""
    event = current_event(conn)
    if row is None or row["status"] != "PAID" or row["event_id"] != event["id"]:
        return {"result": "INVALID"}
    result = {"first_name": row["first_name"], "last_name": row["last_name"], "category": row["category"]}
    if row["checked_in_at"]:
        return {"result": "ALREADY_CHECKED_IN", **result, "checked_in_at": row["checked_in_at"]}
    db.update(conn, "reservations", row["id"], {
        "checked_in_at": to_iso(now), "checked_in_by_access_id": admin["account_id"], "updated_at": to_iso(now),
    })
    return {"result": "CHECKED_IN", **result, "checked_in_at": to_iso(now)}


def check_in_qr(conn, admin, payload: str, now: datetime) -> dict:
    """Scan: TUBARAO:<token> → hash it → find the PAID ticket of the active event."""
    admin = require_role(conn, admin, DOOR_ROLES)
    token = tickets.parse_payload(payload)
    if token is None:
        return {"result": "INVALID"}
    with db.transaction(conn):
        return _check_in(conn, admin, db.reservation_by_qr_hash(conn, tickets.hash_ticket_token(token)), now)


def check_in_manual(conn, admin, reservation_id: str, now: datetime) -> dict:
    """Fallback when the camera does not work: check in a paid guest found by name."""
    admin = require_role(conn, admin, DOOR_ROLES)
    with db.transaction(conn):
        return _check_in(conn, admin, db.get_reservation(conn, reservation_id), now)


def check_in_non_paying(conn, admin, attendee_id: str, now: datetime) -> dict:
    """Let a resident or invited guest in. They have no QR, so the door finds them by name.
    Single-use and active event only, exactly like a paid ticket."""
    require_role(conn, admin, DOOR_ROLES)
    with db.transaction(conn):
        guest = db.get_non_paying(conn, attendee_id) if isinstance(attendee_id, str) else None
        if guest is None or guest["event_id"] != current_event(conn)["id"]:
            return {"result": "INVALID"}
        result = {"first_name": guest["first_name"], "last_name": guest["last_name"], "category": guest["category"]}
        if guest["checked_in_at"]:
            return {"result": "ALREADY_CHECKED_IN", **result, "checked_in_at": guest["checked_in_at"]}
        db.update(conn, "non_paying_attendees", guest["id"], {"checked_in_at": to_iso(now)})
        return {"result": "CHECKED_IN", **result, "checked_in_at": to_iso(now)}


def search_attendees(conn, admin, query: str, now: datetime, limit: int = 30) -> dict:
    """Find people of the active event by first name, last name, full name or email.

    Returns paid-side bookings (type PAID, with their booking status) and
    non-paying guests (type NON-PAYING, status NON-PAYING).
    """
    require_role(conn, admin, DOOR_ROLES)
    if not isinstance(query, str) or len(query) > 100 or _CONTROL.search(query):
        raise TubaraoError("INVALID_INPUT", "Use up to 100 characters to search.")
    event = current_event(conn)
    refresh_expiry(conn, event, now)
    needle = query.strip().lower()
    if not needle:
        return {"attendees": [], "more": False}

    def matches(row: dict) -> bool:
        texts = (row["first_name"], row["last_name"], row["email"] or "", f"{row['first_name']} {row['last_name']}")
        return any(needle in text.lower() for text in texts)

    found = [{"type": "PAID", "reservation_id": row["id"], "first_name": row["first_name"],
              "last_name": row["last_name"], "email": row["email"], "category": row["category"],
              "status": effective_status(row, event, now), "checked_in_at": row["checked_in_at"]}
             for row in db.reservations_for_event(conn, event["id"]) if matches(row)]
    found += [{"type": "NON-PAYING", "attendee_id": row["id"], "first_name": row["first_name"],
               "last_name": row["last_name"], "email": row["email"], "category": row["category"],
               "status": "NON-PAYING", "checked_in_at": row["checked_in_at"]}
              for row in db.non_paying_for_event(conn, event["id"]) if matches(row)]
    return {"attendees": found[:limit], "more": len(found) > limit}


def presence(conn, admin) -> dict:
    """LIVE ATTENDANCE: only people who have arrived. No emails, no revenue."""
    require_role(conn, admin, DOOR_ROLES)
    event = current_event(conn)
    arrived = [{"first_name": row["first_name"], "last_name": row["last_name"], "category": row["category"],
                "type": "PAID", "checked_in_at": row["checked_in_at"]}
               for row in db.reservations_for_event(conn, event["id"])
               if row["status"] == "PAID" and row["checked_in_at"]]
    arrived += [{"first_name": row["first_name"], "last_name": row["last_name"], "category": row["category"],
                 "type": "NON-PAYING", "checked_in_at": row["checked_in_at"]}
                for row in db.non_paying_for_event(conn, event["id"]) if row["checked_in_at"]]
    total = len(arrived)
    men = sum(1 for person in arrived if person["category"] == "MEN")
    women = sum(1 for person in arrived if person["category"] == "WOMEN")
    percent = lambda count: round(count / total * 100, 1) if total else 0.0  # noqa: E731
    return {"stats": {"total": total, "men": men, "women": women,
                      "men_percentage": percent(men), "women_percentage": percent(women)},
            "attendees": arrived}


# ================================================================ dashboard numbers (organizer)

def kpis(reservations: list[dict], non_paying: list[dict]) -> dict:
    """Attendance and revenue. Only PAID bookings count as attendees or money."""
    paid = [row for row in reservations if row["status"] == "PAID"]
    paid_men = sum(1 for row in paid if row["category"] == "MEN")
    paid_women = sum(1 for row in paid if row["category"] == "WOMEN")
    np_men = sum(1 for row in non_paying if row["category"] == "MEN")
    np_women = sum(1 for row in non_paying if row["category"] == "WOMEN")
    total = len(paid) + len(non_paying)

    def share(count: int, whole: int) -> str:
        return "0%" if whole == 0 else f"{count / whole * 100:.1f}%"

    return {
        "paid": len(paid), "non_paying": len(non_paying), "total": total,
        "paid_men": paid_men, "paid_women": paid_women,
        "total_men": paid_men + np_men, "total_women": paid_women + np_women,
        "paid_men_percent": share(paid_men, len(paid)), "paid_women_percent": share(paid_women, len(paid)),
        "total_men_percent": share(paid_men + np_men, total), "total_women_percent": share(paid_women + np_women, total),
        "checked_in": sum(1 for row in paid if row["checked_in_at"]),
        "revenue_cents": sum(row["amount_cents"] for row in paid),
    }


# ================================================================ dashboard charts (organizer)

def sales_by_day(reservations: list[dict]) -> list[dict]:
    """PAID tickets and their revenue per Lisbon date of confirmation, with empty days as 0."""
    totals: dict = {}
    for row in reservations:
        if row["status"] == "PAID" and row["paid_at"]:
            day = parse_time(row["paid_at"]).astimezone(LISBON).date()
            tickets, revenue = totals.get(day, (0, 0))
            totals[day] = (tickets + 1, revenue + row["amount_cents"])
    if not totals:
        return []
    days, day = [], min(totals)
    while day <= max(totals):
        tickets, revenue = totals.get(day, (0, 0))
        days.append({"day": day.isoformat(), "tickets": tickets, "revenue_cents": revenue})
        day += timedelta(days=1)
    return days


def arrivals_by_quarter_hour(reservations: list[dict], non_paying: list[dict]) -> list[dict]:
    """Check-ins (PAID tickets and non-paying guests) per 15-minute slot in Lisbon time,
    with empty slots between the first and last arrival as 0."""
    times = [row["checked_in_at"] for row in reservations if row["status"] == "PAID" and row["checked_in_at"]]
    times += [row["checked_in_at"] for row in non_paying if row["checked_in_at"]]
    counts: dict = {}
    for value in times:
        moment = parse_time(value).astimezone(timezone.utc)
        slot = moment.replace(minute=moment.minute - moment.minute % 15, second=0, microsecond=0)
        counts[slot] = counts.get(slot, 0) + 1
    if not counts:
        return []
    slots, slot = [], min(counts)  # stepping in UTC keeps the order right across midnight and clock changes
    while slot <= max(counts):
        slots.append({"slot": slot.astimezone(LISBON).strftime("%H:%M"),
                      "slot_start": slot.astimezone(LISBON).isoformat(), "arrivals": counts.get(slot, 0)})
        slot += timedelta(minutes=15)
    return slots


def revenue_by_tier(reservations: list[dict]) -> list[dict]:
    """PAID tickets and revenue for EARLY and LATE (always shown), plus OTHER for tickets with no tier."""
    totals = {"EARLY": [0, 0], "LATE": [0, 0]}
    for row in reservations:
        if row["status"] == "PAID":
            tier = row["pricing_tier"] if row["pricing_tier"] in ("EARLY", "LATE") else "OTHER"
            totals.setdefault(tier, [0, 0])
            totals[tier][0] += 1
            totals[tier][1] += row["amount_cents"]
    return [{"tier": tier, "tickets": tickets, "revenue_cents": revenue} for tier, (tickets, revenue) in totals.items()]


def dashboard(conn, admin, now: datetime) -> dict:
    """Everything the organizer screen needs, read in one go."""
    admin = require_role(conn, admin)
    try:
        event = current_event(conn)
    except TubaraoError:
        return {"admin": admin, "event": None, "reservations": [], "non_paying": [], "kpis": kpis([], []),
                "charts": None, "capacity": None}
    refresh_expiry(conn, event, now)
    reservations = []
    for row in db.reservations_for_event(conn, event["id"]):
        reservations.append({**row, "status": effective_status(row, event, now),
                             "stored_status": row["status"], "can_delete": can_delete_record(row)})
    non_paying = db.non_paying_for_event(conn, event["id"])
    used = occupancy(conn, event, now)
    return {
        "admin": admin, "event": event, "pricing": event_pricing(event, now),
        "reservations": reservations, "non_paying": non_paying, "kpis": kpis(reservations, non_paying),
        "charts": {"sales_by_day": sales_by_day(reservations),
                   "arrivals": arrivals_by_quarter_hour(reservations, non_paying),
                   "revenue_by_tier": revenue_by_tier(reservations)},
        "capacity": {**used, "physical_capacity": event["physical_capacity"], "men_paid_cap": event["men_paid_cap"],
                     "paid_capacity": event["physical_capacity"] - used["non_paying"]},
    }


# ================================================================ downloads (organizer)

BACKUP_COLUMNS = ["First Name", "Last Name", "Email", "Category", "Type", "Status", "Amount EUR", "Checked In", "Checked In At"]


def csv_cell(value) -> str:
    """Stop spreadsheet programs from running text as a formula (=, +, -, @)."""
    text = "" if value is None else str(value)
    if re.match(r"^[\s\ufeff]*[=+@-]", text) or re.match(r"^[\t\r\n]", text):
        text = "'" + text
    return text


def _safe_filename(text: str) -> str:
    plain = unicodedata.normalize("NFKD", text or "Event").encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^A-Za-z0-9]+", "_", plain).strip("_")[:70] or "Event"


def event_backup_csv(conn, admin, now: datetime | None = None, event_id: str | None = None) -> tuple[str, bytes]:
    """Emergency door list. Reading it never changes attendance (it only saves EXPIRED on
    bookings whose time ran out, so the file is accurate). No IDs, QR data or access codes."""
    require_role(conn, admin)
    event = db.get_event(conn, event_id) if event_id is not None else current_event(conn)
    if event is None:
        raise TubaraoError("EVENT_NOT_FOUND")
    refresh_expiry(conn, event, now or utcnow())
    buffer = io.StringIO()
    writer = csv.writer(buffer, quoting=csv.QUOTE_ALL, lineterminator="\r\n")
    writer.writerow(BACKUP_COLUMNS)
    for row in db.reservations_for_event(conn, event["id"]):
        writer.writerow([csv_cell(v) for v in (row["first_name"], row["last_name"], row["email"], row["category"], "PAID",
                         row["status"], f"{row['amount_cents'] / 100:.2f}", "YES" if row["checked_in_at"] else "NO",
                         row["checked_in_at"])])
    for row in db.non_paying_for_event(conn, event["id"]):
        writer.writerow([csv_cell(v) for v in (row["first_name"], row["last_name"], row["email"], row["category"],
                         "NON-PAYING", "NON-PAYING", "0.00", "YES" if row["checked_in_at"] else "NO", row["checked_in_at"])])
    return backup_filename(event), ("\ufeff" + buffer.getvalue()).encode("utf-8")  # BOM so Excel reads accents


def backup_filename(event: dict) -> str:
    date = "_" + lisbon(event["starts_at"], "%Y-%m-%d") if event["starts_at"] else ""
    return f"Tubarao_{_safe_filename(event['name'])}{date}_backup.csv"


def guest_list(conn, admin, event_id: str | None = None) -> tuple[dict, list[dict]]:
    """PAID guests and non-paying guests, sorted by last name then first name."""
    require_role(conn, admin)
    event = db.get_event(conn, event_id) if event_id is not None else current_event(conn)
    if event is None:
        raise TubaraoError("EVENT_NOT_FOUND")
    guests = [{"first_name": r["first_name"], "last_name": r["last_name"]}
              for r in db.reservations_for_event(conn, event["id"]) if r["status"] == "PAID"]
    guests += [{"first_name": r["first_name"], "last_name": r["last_name"]} for r in db.non_paying_for_event(conn, event["id"])]

    def key(guest):
        tidy = lambda text: unicodedata.normalize("NFKD", re.sub(r"\s+", " ", text.strip())).casefold()  # noqa: E731
        return tidy(guest["last_name"]), tidy(guest["first_name"])

    return event, sorted(guests, key=key)
