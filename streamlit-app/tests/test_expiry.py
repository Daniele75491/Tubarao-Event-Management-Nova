"""Fix 1: bookings whose time has run out are saved as EXPIRED, not just shown as expired."""

import csv
import io
from datetime import timedelta

import pytest

import db
import logic
from conftest import NOW

LATER = NOW + timedelta(minutes=25)  # the 20-minute hold has run out


def stored(conn, booking) -> dict:
    return db.get_reservation(conn, booking["reservation_id"])


@pytest.mark.parametrize("read", [
    lambda conn, org, door, b: logic.public_state(conn, LATER),
    lambda conn, org, door, b: logic.reservation_state(conn, b["reservation_id"], b["email"], LATER),
    lambda conn, org, door, b: logic.booking_by_reference(conn, b["reservation_id"], LATER),
    lambda conn, org, door, b: logic.search_attendees(conn, door, "Guest", LATER),
    lambda conn, org, door, b: logic.dashboard(conn, org, LATER),
    lambda conn, org, door, b: logic.event_backup_csv(conn, org, LATER),
], ids=["public page", "guest view", "booking link", "door search", "dashboard", "backup"])
def test_reading_the_event_saves_an_elapsed_hold_as_expired(conn, organizer, door, book, read):
    booking = book()
    assert stored(conn, booking)["status"] == "RESERVED"
    read(conn, organizer, door, booking)
    row = stored(conn, booking)
    assert row["status"] == "EXPIRED"
    assert row["expired_at"] == booking["reserved_until"]  # when its time actually ran out


def test_an_elapsed_claim_is_saved_as_expired_at_the_end_of_its_review_window(conn, organizer, book):
    booking = book()
    logic.claim_payment(conn, booking["reservation_id"], booking["email"], NOW)
    logic.dashboard(conn, organizer, NOW + timedelta(hours=25))
    row = stored(conn, booking)
    assert row["status"] == "EXPIRED"
    assert row["expired_at"] == logic.to_iso(NOW + timedelta(hours=24))


def test_bookings_still_inside_their_time_are_not_touched(conn, organizer, book):
    booking = book()
    logic.dashboard(conn, organizer, NOW + timedelta(minutes=5))
    assert stored(conn, booking)["status"] == "RESERVED" and stored(conn, booking)["expired_at"] is None


def test_the_backup_csv_shows_expired_holds_as_expired(conn, organizer, book):
    book(first="Late")
    rows = list(csv.reader(io.StringIO(logic.event_backup_csv(conn, organizer, LATER)[1].decode("utf-8-sig"))))
    assert [row[5] for row in rows if row[0] == "Late"] == ["EXPIRED"]


def test_paid_rejected_and_already_expired_bookings_are_left_alone(conn, organizer, book, paid):
    ticket = paid()
    claim = book()
    logic.claim_payment(conn, claim["reservation_id"], claim["email"], NOW)
    logic.reject_payment(conn, organizer, claim["reservation_id"], NOW)
    before = {b["reservation_id"]: dict(stored(conn, b)) for b in (ticket, claim)}
    logic.dashboard(conn, organizer, NOW + timedelta(days=3))
    assert {b["reservation_id"]: stored(conn, b) for b in (ticket, claim)} == before
