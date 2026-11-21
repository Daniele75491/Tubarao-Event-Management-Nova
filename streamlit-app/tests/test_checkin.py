"""The door: single-use check-in, invalid tickets, search and live attendance."""

from datetime import timedelta

import pytest

import db
import logic
import tickets
from conftest import NOW, SECRET


def payload_for(conn, reservation_id):
    row = db.get_reservation(conn, reservation_id)
    return tickets.ticket_payload(tickets.derive_ticket_token(row["id"], row["event_id"], SECRET))


def test_a_valid_ticket_checks_in_once_and_then_shows_already_checked_in(conn, door, paid):
    booking = paid("MEN", first="Bruno")
    payload = payload_for(conn, booking["reservation_id"])
    first = logic.check_in_qr(conn, door, payload, NOW)
    assert (first["result"], first["first_name"], first["category"]) == ("CHECKED_IN", "Bruno", "MEN")
    second = logic.check_in_qr(conn, door, payload, NOW + timedelta(minutes=10))
    assert second["result"] == "ALREADY_CHECKED_IN"
    assert second["checked_in_at"] == first["checked_in_at"]  # shows the original time


def test_the_check_in_records_which_door_account_did_it(conn, door, paid):
    booking = paid()
    logic.check_in_qr(conn, door, payload_for(conn, booking["reservation_id"]), NOW)
    assert db.get_reservation(conn, booking["reservation_id"])["checked_in_by_access_id"] == door["account_id"]


@pytest.mark.parametrize("payload", ["hello", "TUBARAO:" + "A" * 43])
def test_unknown_codes_are_invalid(conn, door, event, payload):
    assert logic.check_in_qr(conn, door, payload, NOW) == {"result": "INVALID"}


def test_a_booking_that_is_not_paid_cannot_check_in(conn, door, event, book):
    booking = book()
    logic.claim_payment(conn, booking["reservation_id"], booking["email"], NOW)
    assert logic.check_in_manual(conn, door, booking["reservation_id"], NOW)["result"] == "INVALID"


def test_a_ticket_from_another_event_is_invalid(conn, organizer, door, make_event, paid):
    booking = paid()
    payload = payload_for(conn, booking["reservation_id"])
    make_event(name="Next Party")  # activating it switches the door to the new event
    assert logic.check_in_qr(conn, door, payload, NOW)["result"] == "INVALID"


def test_a_deleted_paid_ticket_stops_working(conn, organizer, door, paid):
    booking = paid()
    payload = payload_for(conn, booking["reservation_id"])
    logic.delete_paid_ticket(conn, organizer, booking["reservation_id"])
    assert logic.check_in_qr(conn, door, payload, NOW)["result"] == "INVALID"


def test_signed_out_people_cannot_check_in_guests(conn, paid):
    booking = paid()
    with pytest.raises(logic.TubaraoError):
        logic.check_in_manual(conn, None, booking["reservation_id"], NOW)


def test_manual_check_in_is_also_single_use(conn, door, paid):
    booking = paid()
    assert logic.check_in_manual(conn, door, booking["reservation_id"], NOW)["result"] == "CHECKED_IN"
    assert logic.check_in_manual(conn, door, booking["reservation_id"], NOW)["result"] == "ALREADY_CHECKED_IN"


def test_search_finds_guests_by_name_or_part_of_the_email(conn, door, book):
    book(first="Joana", email="joana.silva@example.test")
    book(first="Pedro", email="pedro@example.test")
    assert [p["first_name"] for p in logic.search_attendees(conn, door, "SILVA", NOW)["attendees"]] == ["Joana"]
    assert [p["first_name"] for p in logic.search_attendees(conn, door, "pedro demo", NOW)["attendees"]] == ["Pedro"]
    assert logic.search_attendees(conn, door, "   ", NOW)["attendees"] == []


def test_live_attendance_lists_only_arrivals_without_emails(conn, door, paid):
    inside = paid("WOMEN")
    paid("MEN")  # paid but not arrived
    logic.check_in_manual(conn, door, inside["reservation_id"], NOW)
    data = logic.presence(conn, door)
    assert data["stats"] == {"total": 1, "men": 0, "women": 1, "men_percentage": 0.0, "women_percentage": 100.0}
    assert "email" not in data["attendees"][0]


def test_live_attendance_with_nobody_inside_is_zero_percent(conn, door, event):
    assert logic.presence(conn, door)["stats"]["men_percentage"] == 0.0
