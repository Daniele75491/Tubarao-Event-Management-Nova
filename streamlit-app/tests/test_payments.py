"""Organizer payment decisions and demo ticket issuing."""

from datetime import timedelta

import pytest

import db
import logic
from conftest import NOW, SECRET


def test_confirming_a_claim_makes_it_paid_and_issues_a_ticket(conn, organizer, event, book):
    booking = book()
    logic.claim_payment(conn, booking["reservation_id"], booking["email"], NOW)
    result = logic.confirm_payment(conn, organizer, booking["reservation_id"], NOW, SECRET)
    assert (result["status"], result["ticket_issued"]) == ("PAID", True)
    row = db.get_reservation(conn, booking["reservation_id"])
    assert row["confirmed_by_access_id"] == organizer["account_id"]
    assert len(row["qr_token_hash"]) == 64


def test_a_reservation_without_a_claim_cannot_be_confirmed_normally(conn, organizer, event, book):
    booking = book()
    with pytest.raises(logic.TubaraoError) as error:
        logic.confirm_payment(conn, organizer, booking["reservation_id"], NOW, SECRET)
    assert error.value.code == "PAYMENT_NOT_CLAIMED"


def test_confirming_after_the_review_window_expires_the_booking(conn, organizer, event, book):
    booking = book()
    logic.claim_payment(conn, booking["reservation_id"], booking["email"], NOW)
    result = logic.confirm_payment(conn, organizer, booking["reservation_id"], NOW + timedelta(hours=25), SECRET)
    assert result["status"] == "EXPIRED"
    assert db.get_reservation(conn, booking["reservation_id"])["status"] == "EXPIRED"


def test_rejecting_a_claim_releases_the_place(conn, organizer, make_event, book):
    make_event(physical_capacity=1, men_paid_cap=1)
    booking = book()
    logic.claim_payment(conn, booking["reservation_id"], booking["email"], NOW)
    assert logic.reject_payment(conn, organizer, booking["reservation_id"], NOW)["status"] == "REJECTED"
    assert book()["status"] == "RESERVED"


def test_door_staff_cannot_confirm_payments(conn, door, event, book):
    booking = book()
    logic.claim_payment(conn, booking["reservation_id"], booking["email"], NOW)
    with pytest.raises(logic.TubaraoError) as error:
        logic.confirm_payment(conn, door, booking["reservation_id"], NOW, SECRET)
    assert error.value.code == "FORBIDDEN"


def test_nobody_signed_in_cannot_confirm_payments(conn, event, book):
    booking = book()
    with pytest.raises(logic.TubaraoError) as error:
        logic.reject_payment(conn, None, booking["reservation_id"], NOW)
    assert error.value.code == "UNAUTHORIZED"


def test_external_confirmation_of_a_reserved_booking(conn, organizer, event, book):
    booking = book()
    assert logic.confirm_external_payment(conn, organizer, booking["reservation_id"], NOW, SECRET)["status"] == "PAID"


def test_external_confirmation_restores_an_expired_booking_when_there_is_space(conn, organizer, event, book):
    booking = book()
    later = NOW + timedelta(hours=1)
    assert logic.confirm_external_payment(conn, organizer, booking["reservation_id"], later, SECRET)["status"] == "PAID"


def test_external_confirmation_of_an_expired_booking_rechecks_capacity(conn, organizer, make_event, book):
    make_event(physical_capacity=1, men_paid_cap=1)
    old = book(at=NOW)
    book(at=NOW + timedelta(minutes=30))  # someone else took the freed place
    with pytest.raises(logic.TubaraoError) as error:
        logic.confirm_external_payment(conn, organizer, old["reservation_id"], NOW + timedelta(minutes=31), SECRET)
    assert error.value.code == "EVENT_SOLD_OUT"


def test_external_confirmation_cannot_restore_a_rejected_booking(conn, organizer, event, book):
    booking = book()
    logic.claim_payment(conn, booking["reservation_id"], booking["email"], NOW)
    logic.reject_payment(conn, organizer, booking["reservation_id"], NOW)
    with pytest.raises(logic.TubaraoError):
        logic.confirm_external_payment(conn, organizer, booking["reservation_id"], NOW, SECRET)


def test_an_expired_claim_is_first_saved_as_expired_then_can_be_restored(conn, organizer, event, book):
    booking = book()
    logic.claim_payment(conn, booking["reservation_id"], booking["email"], NOW)
    later = NOW + timedelta(hours=30)
    assert logic.confirm_external_payment(conn, organizer, booking["reservation_id"], later, SECRET)["status"] == "EXPIRED"
    assert logic.confirm_external_payment(conn, organizer, booking["reservation_id"], later, SECRET)["status"] == "PAID"


def test_external_confirmation_cannot_create_a_second_live_booking_for_one_email(conn, organizer, event, book):
    old = book(first="Ana", email="ana@example.test", at=NOW)
    book(first="Ana", email="ana@example.test", at=NOW + timedelta(minutes=30))
    with pytest.raises(logic.TubaraoError) as error:
        logic.confirm_external_payment(conn, organizer, old["reservation_id"], NOW + timedelta(minutes=31), SECRET)
    assert error.value.code == "ACTIVE_RESERVATION_EXISTS"


def test_confirming_twice_keeps_the_first_confirmer_and_does_not_reissue(conn, organizer, event, paid):
    booking = paid()
    first_issue = db.get_reservation(conn, booking["reservation_id"])["ticket_issued_at"]
    second = logic.create_access_account(conn, "Second organizer", "SUPER_ADMIN", "second-org-code")
    other = {"account_id": second, "label": "Second organizer", "role": "SUPER_ADMIN"}
    logic.confirm_payment(conn, other, booking["reservation_id"], NOW + timedelta(minutes=5), SECRET)
    row = db.get_reservation(conn, booking["reservation_id"])
    assert row["confirmed_by_access_id"] == organizer["account_id"]
    assert row["ticket_issued_at"] == first_issue


def test_retry_ticket_reproduces_exactly_the_same_qr(conn, organizer, event, paid):
    booking = paid()
    before = db.get_reservation(conn, booking["reservation_id"])["qr_token_hash"]
    png_before = logic.ticket_qr(conn, organizer, booking["reservation_id"], SECRET)
    logic.retry_ticket(conn, organizer, booking["reservation_id"], NOW, SECRET)
    assert db.get_reservation(conn, booking["reservation_id"])["qr_token_hash"] == before
    assert logic.ticket_qr(conn, organizer, booking["reservation_id"], SECRET) == png_before


def test_a_failed_ticket_keeps_the_booking_paid(conn, organizer, event, book):
    booking = book()
    logic.claim_payment(conn, booking["reservation_id"], booking["email"], NOW)
    result = logic.confirm_payment(conn, organizer, booking["reservation_id"], NOW, "too-short-secret")
    assert (result["status"], result["ticket_issued"]) == ("PAID", False)
    assert result["ticket_error"] == logic.TICKET_FAILED
    assert logic.retry_ticket(conn, organizer, booking["reservation_id"], NOW, SECRET)["ticket_issued"] is True


def test_a_different_signing_secret_is_detected_not_silently_replaced(conn, organizer, event, paid):
    booking = paid()
    with pytest.raises(logic.TubaraoError) as error:
        logic.ticket_qr(conn, organizer, booking["reservation_id"], SECRET + "-changed")
    assert error.value.code == "TICKET_HASH_MISMATCH"
    result = logic.retry_ticket(conn, organizer, booking["reservation_id"], NOW, SECRET + "-changed")
    assert result["ticket_error"] == logic.TICKET_MISMATCH


def test_qr_download_needs_an_issued_paid_ticket(conn, organizer, event, book):
    booking = book()
    with pytest.raises(logic.TubaraoError):
        logic.ticket_qr(conn, organizer, booking["reservation_id"], SECRET)
