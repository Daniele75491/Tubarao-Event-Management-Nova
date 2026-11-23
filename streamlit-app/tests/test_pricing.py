"""EARLY / LATE prices, and every booking keeping the price it was created with."""

from datetime import timedelta

import pytest

import logic
from conftest import NOW


def test_auto_pricing_is_early_before_the_deadline_and_late_from_it(make_event):
    event = make_event(early_price_ends_at=NOW + timedelta(hours=1))
    assert logic.event_pricing(event, NOW)["phase"] == "EARLY"
    assert logic.event_pricing(event, NOW + timedelta(hours=1))["phase"] == "LATE"  # equal time means LATE
    assert logic.event_pricing(event, NOW + timedelta(hours=1))["current_price_cents"] == 1200


def test_auto_pricing_without_a_deadline_stays_early(make_event):
    event = make_event(early_price_ends_at=None)
    assert logic.event_pricing(event, NOW + timedelta(days=365))["phase"] == "EARLY"


@pytest.mark.parametrize("mode,phase,price", [("EARLY", "EARLY", 800), ("LATE", "LATE", 1200)])
def test_forced_modes_ignore_the_deadline(make_event, mode, phase, price):
    event = make_event(pricing_mode=mode, early_price_ends_at=NOW - timedelta(days=1) if mode == "EARLY" else NOW + timedelta(days=1))
    pricing = logic.event_pricing(event, NOW)
    assert (pricing["phase"], pricing["current_price_cents"]) == (phase, price)
    assert pricing["early_price_ends_at"] is None  # forced modes have no countdown


def test_a_booking_keeps_its_early_price_after_the_price_rises(conn, make_event, book):
    make_event(early_price_ends_at=NOW + timedelta(minutes=5))
    early = book("WOMEN", at=NOW)
    later = NOW + timedelta(minutes=10)
    assert logic.reservation_state(conn, early["reservation_id"], early["email"], later)["amount_cents"] == 800
    late = book("WOMEN", at=later)
    assert (late["amount_cents"], late["pricing_tier"]) == (1200, "LATE")


def test_editing_event_prices_does_not_reprice_existing_bookings(conn, organizer, event, book):
    booking = book()
    logic.update_event(conn, organizer, event["id"], {"early_price_cents": 2000}, NOW)
    assert logic.reservation_state(conn, booking["reservation_id"], booking["email"], NOW)["amount_cents"] == 800


def test_public_next_price_is_hidden_unless_the_organizer_shows_it(conn, organizer, event):
    assert logic.public_state(conn, NOW)["pricing"]["next_price_cents"] is None
    logic.update_event(conn, organizer, event["id"], {"show_late_price_before_start": True}, NOW)
    assert logic.public_state(conn, NOW)["pricing"]["next_price_cents"] == 1200


def test_revenue_sums_the_actual_paid_amounts():
    rows = [{"status": "PAID", "category": "WOMEN", "amount_cents": 800, "checked_in_at": None}] * 10
    rows += [{"status": "PAID", "category": "MEN", "amount_cents": 1200, "checked_in_at": None}] * 5
    rows += [{"status": "PAYMENT_CLAIMED", "category": "MEN", "amount_cents": 1200, "checked_in_at": None}]
    assert logic.kpis(rows, [])["revenue_cents"] == 14000  # 10 × €8 + 5 × €12 = €140


@pytest.mark.parametrize("bad", [0, 100001, 8.5, "800", True])
def test_event_prices_must_be_whole_cents_between_one_cent_and_1000_euros(conn, organizer, bad):
    with pytest.raises(logic.TubaraoError):
        logic.create_event(conn, organizer, {"name": "X", "early_price_cents": bad}, NOW)


@pytest.mark.parametrize("text,cents", [("8", 800), ("8.5", 850), ("8,50", 850), ("€12.00", 1200), ("0.01", 1)])
def test_euro_amounts_are_converted_to_cents(text, cents):
    assert logic.euros_to_cents(text) == cents


@pytest.mark.parametrize("text", ["0", "8.555", "abc", "1000.01", "-5"])
def test_invalid_euro_amounts_are_refused(text):
    with pytest.raises(logic.TubaraoError):
        logic.euros_to_cents(text)
