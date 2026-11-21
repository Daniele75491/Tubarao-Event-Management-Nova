"""Guest bookings: creating, resuming, claiming and validation."""

from datetime import timedelta

import pytest

import logic
from conftest import NOW


def test_a_new_booking_is_reserved_for_the_event_hold_time(event, book):
    booking = book("WOMEN")
    assert booking["status"] == "RESERVED"
    assert logic.parse_time(booking["reserved_until"]) == NOW + timedelta(minutes=20)
    assert booking["resumed"] is False


def test_entering_the_same_details_again_resumes_the_same_booking(conn, event, book):
    first = book("WOMEN", first="Ana", email="ana@example.test")
    again = logic.reserve(conn, "  ANA ", "demo", "Ana@Example.test ", "WOMEN", NOW + timedelta(minutes=5))
    assert again["reservation_id"] == first["reservation_id"]
    assert again["reserved_until"] == first["reserved_until"]  # the deadline is never reset
    assert again["resumed"] is True


def test_resume_works_even_when_sales_are_closed(conn, organizer, event, book):
    first = book("WOMEN", first="Ana", email="ana@example.test")
    logic.update_event(conn, organizer, event["id"], {"sales_mode": "CLOSED"}, NOW)
    again = logic.reserve(conn, "Ana", "Demo", "ana@example.test", "WOMEN", NOW)
    assert again["reservation_id"] == first["reservation_id"]


@pytest.mark.parametrize("first,category", [("Someone", "WOMEN"), ("Ana", "MEN")])
def test_the_same_email_with_other_details_is_refused(conn, event, book, first, category):
    book("WOMEN", first="Ana", email="ana@example.test")
    with pytest.raises(logic.TubaraoError) as error:
        logic.reserve(conn, first, "Demo", "ana@example.test", category, NOW)
    assert error.value.code == "ACTIVE_RESERVATION_EXISTS"


def test_after_a_booking_expires_the_same_email_can_book_again(conn, event, book):
    first = book("WOMEN", first="Ana", email="ana@example.test")
    again = logic.reserve(conn, "Ana", "Demo", "ana@example.test", "WOMEN", NOW + timedelta(minutes=30))
    assert again["reservation_id"] != first["reservation_id"]


@pytest.mark.parametrize("first,last,email,category", [
    ("", "Demo", "a@example.test", "WOMEN"),
    ("A" * 101, "Demo", "a@example.test", "WOMEN"),
    ("Ana", "Demo", "not-an-email", "WOMEN"),
    ("Ana", "Demo", "a@example.test", "OTHER"),
    ("Ana\x00", "Demo", "a@example.test", "WOMEN"),
])
def test_invalid_details_are_refused(conn, event, first, last, email, category):
    with pytest.raises(logic.TubaraoError):
        logic.reserve(conn, first, last, email, category, NOW)


def test_no_active_event_means_no_bookings(conn):
    with pytest.raises(logic.TubaraoError) as error:
        logic.reserve(conn, "Ana", "Demo", "ana@example.test", "WOMEN", NOW)
    assert error.value.code == "EVENT_NOT_FOUND"


def test_claiming_payment_moves_the_booking_to_payment_claimed(conn, event, book):
    booking = book()
    view = logic.claim_payment(conn, booking["reservation_id"], booking["email"], NOW + timedelta(minutes=1))
    assert view["status"] == "PAYMENT_CLAIMED"
    assert logic.parse_time(view["claim_expires_at"]) == NOW + timedelta(minutes=1, hours=24)


def test_claiming_twice_is_harmless(conn, event, book):
    booking = book()
    logic.claim_payment(conn, booking["reservation_id"], booking["email"], NOW)
    assert logic.claim_payment(conn, booking["reservation_id"], booking["email"], NOW)["status"] == "PAYMENT_CLAIMED"


def test_a_claim_needs_the_matching_email(conn, event, book):
    booking = book()
    with pytest.raises(logic.TubaraoError) as error:
        logic.claim_payment(conn, booking["reservation_id"], "someone.else@example.test", NOW)
    assert error.value.code == "RESERVATION_NOT_FOUND"


def test_a_claim_after_the_hold_ended_is_refused_and_saved_as_expired(conn, event, book):
    booking = book()
    later = NOW + timedelta(minutes=21)
    with pytest.raises(logic.TubaraoError) as error:
        logic.claim_payment(conn, booking["reservation_id"], booking["email"], later)
    assert error.value.code == "INVALID_RESERVATION_STATUS"
    assert logic.reservation_state(conn, booking["reservation_id"], booking["email"], later)["status"] == "EXPIRED"


def test_the_guest_view_never_contains_the_qr_or_staff_data(conn, paid):
    booking = paid()
    view = logic.reservation_state(conn, booking["reservation_id"], booking["email"], NOW)
    assert view["status"] == "PAID"
    assert not {"qr_token_hash", "confirmed_by_access_id", "email"} & set(view)
