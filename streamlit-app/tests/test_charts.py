"""The three dashboard charts: tickets sold per day, arrivals per 15 minutes, revenue by price tier."""

from datetime import timedelta

import pytest

import logic
from conftest import NOW


def ticket(status="PAID", paid_at=None, checked_in_at=None, tier="EARLY", amount=800, category="WOMEN"):
    """A made-up reservation row with only the fields the charts use."""
    return {"status": status, "paid_at": paid_at, "checked_in_at": checked_in_at,
            "pricing_tier": tier, "amount_cents": amount, "category": category}


# ------------------------------------------------------------------ tickets sold per day

def test_sales_are_counted_per_lisbon_day_with_revenue():
    rows = [ticket(paid_at="2026-12-01T10:00:00+00:00"), ticket(paid_at="2026-12-01T20:00:00+00:00", amount=1200),
            ticket(paid_at="2026-12-02T09:00:00+00:00")]
    assert logic.sales_by_day(rows) == [
        {"day": "2026-12-01", "tickets": 2, "revenue_cents": 2000},
        {"day": "2026-12-02", "tickets": 1, "revenue_cents": 800},
    ]


def test_only_paid_tickets_count_as_sales():
    rows = [ticket(paid_at="2026-12-01T10:00:00+00:00"),
            ticket(status="PAYMENT_CLAIMED", paid_at=None), ticket(status="RESERVED"), ticket(status="REJECTED")]
    assert logic.sales_by_day(rows) == [{"day": "2026-12-01", "tickets": 1, "revenue_cents": 800}]


def test_days_without_sales_show_as_zero():
    rows = [ticket(paid_at="2026-12-01T10:00:00+00:00"), ticket(paid_at="2026-12-04T10:00:00+00:00")]
    assert [(d["day"], d["tickets"]) for d in logic.sales_by_day(rows)] == [
        ("2026-12-01", 1), ("2026-12-02", 0), ("2026-12-03", 0), ("2026-12-04", 1)]


def test_a_late_night_summer_sale_counts_on_the_lisbon_date():
    # 23:30 UTC in July is 00:30 the next day in Lisbon (summer time, UTC+1).
    rows = [ticket(paid_at="2026-07-01T23:30:00+00:00")]
    assert logic.sales_by_day(rows)[0]["day"] == "2026-07-02"


def test_no_sales_means_no_days():
    assert logic.sales_by_day([]) == []


# ------------------------------------------------------------------ arrivals per 15 minutes

def test_arrivals_are_grouped_into_15_minute_lisbon_slots():
    # December: Lisbon is on UTC+0.
    rows = [ticket(checked_in_at="2026-12-06T18:01:00+00:00"), ticket(checked_in_at="2026-12-06T18:14:59+00:00"),
            ticket(checked_in_at="2026-12-06T18:15:00+00:00")]
    assert [(a["slot"], a["arrivals"]) for a in logic.arrivals_by_quarter_hour(rows, [])] == [
        ("18:00", 2), ("18:15", 1)]


def test_summer_arrivals_use_lisbon_summer_time():
    rows = [ticket(checked_in_at="2026-07-04T17:07:00+00:00")]  # 18:07 in Lisbon
    assert logic.arrivals_by_quarter_hour(rows, [])[0]["slot"] == "18:00"


def test_non_paying_guests_count_as_arrivals_too():
    rows = [ticket(checked_in_at="2026-12-06T18:05:00+00:00")]
    residents = [{"checked_in_at": "2026-12-06T18:10:00+00:00"}, {"checked_in_at": None}]
    assert logic.arrivals_by_quarter_hour(rows, residents) == [
        {"slot": "18:00", "slot_start": "2026-12-06T18:00:00+00:00", "arrivals": 2}]


def test_unpaid_or_absent_guests_are_not_arrivals():
    rows = [ticket(checked_in_at=None), ticket(status="PAYMENT_CLAIMED", checked_in_at="2026-12-06T18:05:00+00:00")]
    assert logic.arrivals_by_quarter_hour(rows, []) == []


def test_empty_slots_between_arrivals_show_as_zero():
    rows = [ticket(checked_in_at="2026-12-06T18:05:00+00:00"), ticket(checked_in_at="2026-12-06T18:50:00+00:00")]
    assert [(a["slot"], a["arrivals"]) for a in logic.arrivals_by_quarter_hour(rows, [])] == [
        ("18:00", 1), ("18:15", 0), ("18:30", 0), ("18:45", 1)]


def test_arrivals_after_midnight_keep_going_in_order():
    rows = [ticket(checked_in_at="2026-12-06T23:50:00+00:00"), ticket(checked_in_at="2026-12-07T00:05:00+00:00")]
    assert [a["slot"] for a in logic.arrivals_by_quarter_hour(rows, [])] == ["23:45", "00:00"]


# ------------------------------------------------------------------ revenue by price tier

def test_revenue_is_split_by_price_tier():
    rows = [ticket(tier="EARLY", amount=800), ticket(tier="EARLY", amount=800), ticket(tier="LATE", amount=1200)]
    assert logic.revenue_by_tier(rows) == [
        {"tier": "EARLY", "tickets": 2, "revenue_cents": 1600},
        {"tier": "LATE", "tickets": 1, "revenue_cents": 1200},
    ]


def test_tiers_with_no_sales_still_show_as_zero():
    assert logic.revenue_by_tier([]) == [
        {"tier": "EARLY", "tickets": 0, "revenue_cents": 0},
        {"tier": "LATE", "tickets": 0, "revenue_cents": 0},
    ]


def test_revenue_uses_the_adjusted_amount_and_only_paid_tickets():
    rows = [ticket(tier="EARLY", amount=650), ticket(status="PAYMENT_CLAIMED", tier="LATE", amount=1200)]
    assert logic.revenue_by_tier(rows)[0] == {"tier": "EARLY", "tickets": 1, "revenue_cents": 650}
    assert logic.revenue_by_tier(rows)[1]["tickets"] == 0


def test_paid_tickets_without_a_tier_show_as_other():
    rows = [ticket(tier=None, amount=500)]
    assert logic.revenue_by_tier(rows)[-1] == {"tier": "OTHER", "tickets": 1, "revenue_cents": 500}


def test_tier_revenue_adds_up_to_the_revenue_kpi():
    rows = [ticket(tier="EARLY"), ticket(tier="LATE", amount=1200), ticket(tier=None, amount=500)]
    assert sum(t["revenue_cents"] for t in logic.revenue_by_tier(rows)) == logic.kpis(rows, [])["revenue_cents"]


# ------------------------------------------------------------------ on the real dashboard

def test_the_dashboard_includes_the_three_charts(conn, organizer, door, paid):
    booking = paid("WOMEN")
    paid("MEN")
    logic.check_in_manual(conn, door, booking["reservation_id"], NOW + timedelta(hours=2))
    charts = logic.dashboard(conn, organizer, NOW)["charts"]
    assert [d["tickets"] for d in charts["sales_by_day"]] == [2]
    assert [a["arrivals"] for a in charts["arrivals"]] == [1]
    assert charts["revenue_by_tier"][0] == {"tier": "EARLY", "tickets": 2, "revenue_cents": 1600}


def test_door_staff_cannot_get_the_charts(conn, door, event):
    with pytest.raises(logic.TubaraoError) as error:
        logic.dashboard(conn, door, NOW)
    assert error.value.code == "FORBIDDEN"
