"""QA: business rules and edge cases the original test files did not cover yet.

Scenarios covered (see docs/QA-FINAL.md): B, C, E, G, H, L, N, O.
Uses the shared in-memory fixtures from conftest.py and made-up guests only.
"""

import csv
import io
from datetime import timedelta

import pytest

import db
import logic
import tickets
from conftest import NOW, SECRET


def code_of(call) -> str:
    """Run a call that must be refused and return the refusal code."""
    with pytest.raises(logic.TubaraoError) as error:
        call()
    return error.value.code


def claimed(conn, book, category="WOMEN", **kwargs):
    booking = book(category, **kwargs)
    logic.claim_payment(conn, booking["reservation_id"], booking["email"], NOW)
    return booking


# ------------------------------------------------------------------ B. capacity

def test_every_kind_of_place_counts_until_the_event_is_full(conn, organizer, make_event, book, paid):
    event = make_event(physical_capacity=4, men_paid_cap=4)
    logic.add_non_paying(conn, organizer, event["id"], "Rui", "Resident", "MEN", None, NOW)
    paid("WOMEN")
    claim = claimed(conn, book, "MEN")
    book("WOMEN")  # a live 20-minute hold

    # 1 non-paying + 1 paid + 1 claim + 1 hold = 4 = capacity: both categories are now sold out.
    assert code_of(lambda: book("WOMEN")) == "EVENT_SOLD_OUT"
    assert code_of(lambda: book("MEN")) == "EVENT_SOLD_OUT"
    public = logic.public_state(conn, NOW)
    assert (public["women_status"], public["men_status"]) == ("SOLD_OUT", "SOLD_OUT")

    # Rejecting the claim frees exactly one place.
    logic.reject_payment(conn, organizer, claim["reservation_id"], NOW)
    assert book("WOMEN")["status"] == "RESERVED"
    assert code_of(lambda: book("WOMEN")) == "EVENT_SOLD_OUT"


def test_the_last_place_can_be_taken_but_not_one_more(conn, make_event, book):
    make_event(physical_capacity=2, men_paid_cap=2)
    assert book()["status"] == "RESERVED"
    assert book()["status"] == "RESERVED"  # exactly at capacity is allowed
    assert code_of(lambda: book()) == "EVENT_SOLD_OUT"
    assert db.fetch_one(conn, "SELECT COUNT(*) AS n FROM reservations")["n"] == 2


def test_a_full_event_also_refuses_external_confirmation_of_an_expired_booking(conn, organizer, make_event, book):
    make_event(physical_capacity=1, men_paid_cap=1)
    late = book(at=NOW - timedelta(hours=1))  # its hold ran out, so the place was released
    book()  # someone else takes the only place
    assert code_of(lambda: logic.confirm_external_payment(conn, organizer, late["reservation_id"], NOW, SECRET)) == "EVENT_SOLD_OUT"
    assert db.get_reservation(conn, late["reservation_id"])["status"] == "EXPIRED"


# ------------------------------------------------------------------ C. the MEN cap

def test_men_holds_and_claims_use_the_men_cap_and_free_it_when_they_expire(conn, make_event, book):
    make_event(physical_capacity=10, men_paid_cap=2)
    claimed(conn, book, "MEN")
    book("MEN")  # a hold, not paid yet
    assert code_of(lambda: book("MEN")) == "MEN_SOLD_OUT"
    public = logic.public_state(conn, NOW)
    assert public["men_status"] == "SOLD_OUT" and public["women_status"] != "SOLD_OUT"
    assert book("WOMEN")["status"] == "RESERVED"

    # 21 minutes later the MEN hold has run out (the claim is still protected).
    assert book("MEN", at=NOW + timedelta(minutes=21))["status"] == "RESERVED"


def test_moving_a_paid_ticket_into_men_counts_live_men_holds(conn, organizer, make_event, book, paid):
    make_event(physical_capacity=10, men_paid_cap=1)
    woman = paid("WOMEN")
    book("MEN")  # the only MEN place is held by someone else
    assert code_of(lambda: logic.change_paid_category(conn, organizer, woman["reservation_id"], "MEN", NOW)) == "MEN_TICKETS_FULL"
    assert db.get_reservation(conn, woman["reservation_id"])["category"] == "WOMEN"


# ------------------------------------------------------------------ E. invalid payment claims

def test_a_guest_cannot_claim_another_guests_booking_with_their_own_email(conn, event, book):
    mine, theirs = book(), book()
    assert code_of(lambda: logic.claim_payment(conn, theirs["reservation_id"], mine["email"], NOW)) == "RESERVATION_NOT_FOUND"
    assert db.get_reservation(conn, theirs["reservation_id"])["status"] == "RESERVED"


@pytest.mark.parametrize("reference", ["00000000-0000-4000-8000-000000000000", "", None, 42])
def test_claims_with_an_unknown_reference_are_refused(conn, event, book, reference):
    booking = book()
    assert code_of(lambda: logic.claim_payment(conn, reference, booking["email"], NOW)) == "RESERVATION_NOT_FOUND"


def test_a_rejected_booking_cannot_be_claimed_again(conn, organizer, event, book):
    booking = claimed(conn, book)
    logic.reject_payment(conn, organizer, booking["reservation_id"], NOW)
    assert code_of(lambda: logic.claim_payment(conn, booking["reservation_id"], booking["email"], NOW)) == "INVALID_RESERVATION_STATUS"
    assert db.get_reservation(conn, booking["reservation_id"])["status"] == "REJECTED"


def test_claiming_a_paid_booking_changes_nothing(conn, paid):
    booking = paid()
    assert code_of(lambda: logic.claim_payment(conn, booking["reservation_id"], booking["email"], NOW)) == "INVALID_RESERVATION_STATUS"
    row = db.get_reservation(conn, booking["reservation_id"])
    assert row["status"] == "PAID" and row["ticket_issued_at"] is not None


@pytest.mark.xfail(strict=True, reason="QA-BUG-1 in docs/QA-FINAL.md: a booking of an event that is no longer "
                                        "active can still be claimed, but the organizer can never confirm it.")
def test_a_booking_of_an_event_that_is_no_longer_active_cannot_be_claimed(conn, make_event, book):
    old = book()
    make_event(name="Next Party")  # the organizer activates a different event
    assert code_of(lambda: logic.claim_payment(conn, old["reservation_id"], old["email"], NOW)) in (
        "INVALID_RESERVATION_STATUS", "EVENT_CHANGED", "RESERVATION_NOT_FOUND")


def test_after_switching_events_an_old_claim_cannot_be_confirmed(conn, organizer, make_event, book):
    """The confirmation side of QA-BUG-1 already behaves safely: no ticket for another event."""
    old = claimed(conn, book)
    make_event(name="Next Party")
    assert code_of(lambda: logic.confirm_payment(conn, organizer, old["reservation_id"], NOW, SECRET)) == "EVENT_CHANGED"
    assert db.get_reservation(conn, old["reservation_id"])["status"] == "PAYMENT_CLAIMED"


# ------------------------------------------------------------------ G. who may confirm and manage payments

def test_door_staff_cannot_use_any_organizer_payment_or_ticket_action(conn, organizer, door, event, book, paid):
    waiting = claimed(conn, book)
    ticket = paid()
    actions = {
        "reject": lambda: logic.reject_payment(conn, door, waiting["reservation_id"], NOW),
        "confirm external": lambda: logic.confirm_external_payment(conn, door, waiting["reservation_id"], NOW, SECRET),
        "retry ticket": lambda: logic.retry_ticket(conn, door, ticket["reservation_id"], NOW, SECRET),
        "download QR": lambda: logic.ticket_qr(conn, door, ticket["reservation_id"], SECRET),
        "adjust amount": lambda: logic.adjust_amount(conn, door, ticket["reservation_id"], 100, NOW),
        "change category": lambda: logic.change_paid_category(conn, door, ticket["reservation_id"], "MEN", NOW),
        "delete record": lambda: logic.delete_record(conn, door, waiting["reservation_id"]),
        "delete paid ticket": lambda: logic.delete_paid_ticket(conn, door, ticket["reservation_id"]),
        "guest list": lambda: logic.guest_list(conn, door),
        "list events": lambda: logic.list_events(conn, door),
        "create event": lambda: logic.create_event(conn, door, {"name": "Door Party"}, NOW),
        "activate event": lambda: logic.activate_event(conn, door, event["id"], NOW),
    }
    for name, action in actions.items():
        assert code_of(action) == "FORBIDDEN", name
    assert db.get_reservation(conn, waiting["reservation_id"])["status"] == "PAYMENT_CLAIMED"
    assert db.get_reservation(conn, ticket["reservation_id"])["amount_cents"] == 800


@pytest.mark.parametrize("who", [None, {}, {"account_id": "00000000-0000-4000-8000-000000000000", "role": "SUPER_ADMIN"}])
def test_nobody_or_an_invented_account_cannot_confirm(conn, event, book, who):
    booking = claimed(conn, book)
    assert code_of(lambda: logic.confirm_payment(conn, who, booking["reservation_id"], NOW, SECRET)) == "UNAUTHORIZED"
    assert db.get_reservation(conn, booking["reservation_id"])["status"] == "PAYMENT_CLAIMED"


def test_a_deactivated_organizer_cannot_confirm_even_with_an_old_identity(conn, organizer, event, book):
    booking = claimed(conn, book)
    db.update(conn, "admin_access_accounts", organizer["account_id"], {"is_active": 0})
    assert code_of(lambda: logic.confirm_payment(conn, organizer, booking["reservation_id"], NOW, SECRET)) == "UNAUTHORIZED"
    assert db.get_reservation(conn, booking["reservation_id"])["paid_at"] is None


def test_the_confirming_organizer_is_recorded(conn, organizer, event, book):
    booking = claimed(conn, book)
    logic.confirm_payment(conn, organizer, booking["reservation_id"], NOW, SECRET)
    row = db.get_reservation(conn, booking["reservation_id"])
    assert row["confirmed_by_access_id"] == organizer["account_id"] and row["paid_at"] is not None


# ------------------------------------------------------------------ H. the QR ticket

def test_the_issued_qr_matches_the_stored_fingerprint_and_the_token_is_never_stored(conn, organizer, paid):
    booking = paid()
    payload = tickets.decode_qr_image(logic.ticket_qr(conn, organizer, booking["reservation_id"], SECRET))
    token = payload.removeprefix("TUBARAO:")
    row = db.get_reservation(conn, booking["reservation_id"])
    assert row["qr_token_hash"] == tickets.hash_ticket_token(token)
    assert token not in str(db.fetch_all(conn, "SELECT * FROM reservations"))


def test_two_tickets_never_share_a_qr(conn, organizer, paid):
    first, second = paid(), paid()
    codes = {tickets.decode_qr_image(logic.ticket_qr(conn, organizer, b["reservation_id"], SECRET)) for b in (first, second)}
    assert len(codes) == 2


# ------------------------------------------------------------------ O. bookings that must never get in

def _reserved(conn, organizer, book):
    return book()


def _claimed(conn, organizer, book):
    return claimed(conn, book)


def _rejected(conn, organizer, book):
    booking = claimed(conn, book)
    logic.reject_payment(conn, organizer, booking["reservation_id"], NOW)
    return booking


def _expired_hold(conn, organizer, book):
    return book(at=NOW - timedelta(hours=1))


def _expired_claim(conn, organizer, book):
    booking = book(at=NOW - timedelta(hours=30))
    logic.claim_payment(conn, booking["reservation_id"], booking["email"], NOW - timedelta(hours=30))
    return booking  # its 24-hour review window ended 6 hours ago


@pytest.mark.parametrize("make", [_reserved, _claimed, _rejected, _expired_hold, _expired_claim])
def test_unpaid_rejected_or_expired_bookings_cannot_be_checked_in_by_name(conn, organizer, door, event, book, make):
    booking = make(conn, organizer, book)
    assert logic.check_in_manual(conn, door, booking["reservation_id"], NOW) == {"result": "INVALID"}
    assert db.get_reservation(conn, booking["reservation_id"])["checked_in_at"] is None


def test_a_qr_made_with_a_different_secret_is_invalid(conn, door, paid):
    booking = paid()
    row = db.get_reservation(conn, booking["reservation_id"])
    forged = tickets.ticket_payload(tickets.derive_ticket_token(row["id"], row["event_id"], "another-secret-that-is-also-long-enough"))
    assert logic.check_in_qr(conn, door, forged, NOW) == {"result": "INVALID"}
    assert db.get_reservation(conn, booking["reservation_id"])["checked_in_at"] is None


def test_a_paid_ticket_of_a_previous_event_cannot_be_checked_in_by_name(conn, door, make_event, paid):
    booking = paid()
    make_event(name="Next Party")
    assert logic.check_in_manual(conn, door, booking["reservation_id"], NOW) == {"result": "INVALID"}


def test_a_deactivated_door_account_cannot_check_in(conn, door, paid):
    booking = paid()
    db.update(conn, "admin_access_accounts", door["account_id"], {"is_active": 0})
    assert code_of(lambda: logic.check_in_manual(conn, door, booking["reservation_id"], NOW)) == "UNAUTHORIZED"
    assert db.get_reservation(conn, booking["reservation_id"])["checked_in_at"] is None


# ------------------------------------------------------------------ L. attendance totals

def test_live_attendance_and_the_dashboard_tell_the_same_story(conn, organizer, door, event, book, paid):
    inside = [paid("WOMEN", first="Ana"), paid("MEN", first="Bruno")]
    paid("WOMEN", first="Carla")  # paid but not arrived yet
    claimed(conn, book, "MEN", first="Diogo")  # not paid: never counted
    rui = logic.add_non_paying(conn, organizer, event["id"], "Rui", "Resident", "MEN", None, NOW)
    logic.add_non_paying(conn, organizer, event["id"], "Marta", "Resident", "WOMEN", None, NOW)
    for booking in inside:
        logic.check_in_manual(conn, door, booking["reservation_id"], NOW)
    logic.check_in_non_paying(conn, door, rui["id"], NOW)

    live = logic.presence(conn, door)
    numbers = logic.dashboard(conn, organizer, NOW)["kpis"]
    assert live["stats"] == {"total": 3, "men": 2, "women": 1, "men_percentage": 66.7, "women_percentage": 33.3}
    assert sorted(p["first_name"] for p in live["attendees"]) == ["Ana", "Bruno", "Rui"]
    assert (numbers["paid"], numbers["non_paying"], numbers["total"]) == (3, 2, 5)
    assert numbers["checked_in"] == 2  # the dashboard figure is "paid checked in"
    assert numbers["revenue_cents"] == 3 * 800
    # Paid arrivals + non-paying arrivals on the dashboard = live attendance total.
    arrived_non_paying = sum(1 for p in logic.dashboard(conn, organizer, NOW)["non_paying"] if p["checked_in_at"])
    assert numbers["checked_in"] + arrived_non_paying == live["stats"]["total"]


def test_live_attendance_never_shows_emails_or_ids(conn, organizer, door, event, paid):
    booking = paid()
    logic.check_in_manual(conn, door, booking["reservation_id"], NOW)
    text = str(logic.presence(conn, door))
    assert booking["email"] not in text and booking["reservation_id"] not in text and event["id"] not in text


# ------------------------------------------------------------------ N. exports

def test_the_backup_csv_contains_no_secrets_ids_or_staff_data(conn, organizer, door, event, book, paid):
    ticket = paid(first="Ana")
    logic.check_in_manual(conn, door, ticket["reservation_id"], NOW)
    book(first="Bruno")
    logic.login(conn, "organizer-code-1", NOW)  # creates a session row that must not leak
    text = logic.event_backup_csv(conn, organizer)[1].decode("utf-8-sig")

    forbidden = [event["id"], organizer["account_id"], door["account_id"], "organizer-code-1", "door-code-1234"]
    for row in db.fetch_all(conn, "SELECT id, qr_token_hash FROM reservations"):
        forbidden += [row["id"], row["qr_token_hash"]]
    for row in db.fetch_all(conn, "SELECT code_salt, code_hash FROM admin_access_accounts"):
        forbidden += [row["code_salt"], row["code_hash"]]
    forbidden += [row["session_token_hash"] for row in db.fetch_all(conn, "SELECT session_token_hash FROM admin_sessions")]
    leaks = [value for value in forbidden if value and value in text]
    assert leaks == []

    rows = list(csv.reader(io.StringIO(text)))
    ana = [row for row in rows if row[0] == "Ana"][0]
    assert dict(zip(logic.BACKUP_COLUMNS, ana))["Checked In"] == "YES"
    assert all(len(row) == len(logic.BACKUP_COLUMNS) for row in rows)


def test_downloading_exports_never_changes_the_database(conn, organizer, door, event, book, paid):
    paid()
    book()
    logic.add_non_paying(conn, organizer, event["id"], "Rui", "Resident", "MEN", None, NOW)

    def snapshot():
        return {table: db.fetch_all(conn, f"SELECT * FROM {table} ORDER BY id")
                for table in ("events", "reservations", "non_paying_attendees", "reservation_amount_adjustments")}

    before = snapshot()
    logic.event_backup_csv(conn, organizer)
    logic.guest_list(conn, organizer)
    assert snapshot() == before


def test_the_guest_list_has_only_people_allowed_in_and_no_contact_details(conn, organizer, event, book, paid):
    paid(first="Paid", last="Guest")
    logic.add_non_paying(conn, organizer, event["id"], "Rui", "Resident", "MEN", "rui@example.test", NOW)
    book(first="Held", last="Only")
    claimed(conn, book, first="Claimed", last="Only")
    rejected = claimed(conn, book, first="Rejected", last="Only")
    logic.reject_payment(conn, organizer, rejected["reservation_id"], NOW)
    book(first="Expired", last="Only", at=NOW - timedelta(hours=2))

    _event, guests = logic.guest_list(conn, organizer)
    assert sorted(g["first_name"] for g in guests) == ["Paid", "Rui"]
    assert all(set(g) == {"first_name", "last_name"} for g in guests)
