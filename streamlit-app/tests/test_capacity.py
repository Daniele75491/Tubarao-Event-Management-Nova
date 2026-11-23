"""Places, the MEN cap, non-paying guests, sales timing and what the public may see."""

from datetime import timedelta

import pytest

import logic
from conftest import NOW


def test_non_paying_guests_reduce_the_places_for_sale(conn, organizer, event, book):
    for n in range(4):
        logic.add_non_paying(conn, organizer, event["id"], f"Resident{n}", "House", "WOMEN", None, NOW)
    for _ in range(6):  # 10 places − 4 residents = 6 for sale
        book("WOMEN")
    with pytest.raises(logic.TubaraoError) as error:
        book("WOMEN")
    assert error.value.code == "EVENT_SOLD_OUT"


def test_men_cap_blocks_men_but_not_women(conn, event, book):
    for _ in range(4):
        book("MEN")
    with pytest.raises(logic.TubaraoError) as error:
        book("MEN")
    assert error.value.code == "MEN_SOLD_OUT"
    assert book("WOMEN")["status"] == "RESERVED"


def test_non_paying_men_do_not_use_the_paid_men_cap(conn, organizer, event, book):
    logic.add_non_paying(conn, organizer, event["id"], "Rui", "Resident", "MEN", None, NOW)
    for _ in range(4):
        book("MEN")


def test_an_expired_hold_releases_its_place(conn, make_event, book):
    make_event(physical_capacity=1, men_paid_cap=1)
    book("WOMEN", at=NOW)
    with pytest.raises(logic.TubaraoError):
        book("WOMEN", at=NOW + timedelta(minutes=5))
    assert book("WOMEN", at=NOW + timedelta(minutes=21))["status"] == "RESERVED"


def test_a_claim_keeps_the_place_after_the_20_minutes_until_the_review_window_ends(conn, make_event, book):
    make_event(physical_capacity=1, men_paid_cap=1, claim_hold_hours=2)
    first = book("WOMEN", at=NOW)
    logic.claim_payment(conn, first["reservation_id"], first["email"], NOW + timedelta(minutes=10))
    with pytest.raises(logic.TubaraoError):
        book("WOMEN", at=NOW + timedelta(hours=1))
    assert book("WOMEN", at=NOW + timedelta(hours=3))["status"] == "RESERVED"


def test_closed_sales_block_new_bookings(make_event, book):
    make_event(sales_mode="CLOSED")
    with pytest.raises(logic.TubaraoError) as error:
        book()
    assert error.value.code == "SALES_CLOSED"


def test_scheduled_sales_follow_the_window_including_the_exact_closing_time(make_event, book):
    make_event(sales_mode="SCHEDULED", sales_open_at=NOW, sales_close_at=NOW + timedelta(hours=1))
    with pytest.raises(logic.TubaraoError):
        book(at=NOW - timedelta(seconds=1))
    assert book(at=NOW + timedelta(hours=1))["status"] == "RESERVED"
    with pytest.raises(logic.TubaraoError):
        book(at=NOW + timedelta(hours=1, seconds=1))


def test_public_state_uses_words_and_never_exact_counts(conn, make_event, book):
    make_event(physical_capacity=40, men_paid_cap=20)
    state = logic.public_state(conn, NOW)
    assert (state["women_status"], state["men_status"]) == ("AVAILABLE", "AVAILABLE")
    for _ in range(26):  # 14 places left: below the FEW TICKETS LEFT threshold of 15
        book("WOMEN")
    state = logic.public_state(conn, NOW)
    assert state["women_status"] == "FEW_TICKETS_LEFT"
    for word in ("capacity", "remaining", "men_paid_cap", "count"):
        assert word not in str(state.keys())


def test_public_state_is_sold_out_when_sales_are_closed(conn, make_event):
    make_event(sales_mode="CLOSED")
    state = logic.public_state(conn, NOW)
    assert (state["sales_status"], state["women_status"], state["men_status"]) == ("CLOSED", "SOLD_OUT", "SOLD_OUT")


def test_adding_a_non_paying_guest_to_a_full_event_is_refused(conn, organizer, make_event, book):
    event = make_event(physical_capacity=1, men_paid_cap=1)
    book()
    with pytest.raises(logic.TubaraoError) as error:
        logic.add_non_paying(conn, organizer, event["id"], "Rui", "Resident", "MEN", None, NOW)
    assert error.value.code == "EVENT_FULL"


def test_capacity_and_men_cap_cannot_drop_below_places_taken(conn, organizer, event, book):
    book("MEN")
    book("MEN")
    book("WOMEN")
    with pytest.raises(logic.TubaraoError) as error:
        logic.update_event(conn, organizer, event["id"], {"physical_capacity": 2, "men_paid_cap": 2}, NOW)
    assert error.value.code == "CAPACITY_TOO_LOW"
    with pytest.raises(logic.TubaraoError) as error:
        logic.update_event(conn, organizer, event["id"], {"men_paid_cap": 1}, NOW)
    assert error.value.code == "MEN_CAP_TOO_LOW"
    assert logic.update_event(conn, organizer, event["id"], {"physical_capacity": 3, "men_paid_cap": 3}, NOW)["physical_capacity"] == 3


def test_shortening_the_review_window_still_counts_claims_under_the_longer_window(conn, organizer, make_event, book):
    event = make_event(physical_capacity=2, men_paid_cap=2, claim_hold_hours=24)
    booking = book(at=NOW)
    logic.claim_payment(conn, booking["reservation_id"], booking["email"], NOW)
    book(at=NOW + timedelta(hours=2))
    later = NOW + timedelta(hours=2)
    with pytest.raises(logic.TubaraoError) as error:  # the 1-hour window must not "free" the claimed place
        logic.update_event(conn, organizer, event["id"], {"claim_hold_hours": 1, "physical_capacity": 1, "men_paid_cap": 1},
                            later)
    assert error.value.code == "CAPACITY_TOO_LOW"


def test_men_cap_cannot_exceed_capacity(conn, organizer):
    with pytest.raises(logic.TubaraoError):
        logic.create_event(conn, organizer, {"name": "X", "physical_capacity": 10, "men_paid_cap": 11}, NOW)
