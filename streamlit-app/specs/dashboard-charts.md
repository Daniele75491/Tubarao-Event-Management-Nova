# Charts on the organizer dashboard

## Why
The dashboard shows totals (paid, revenue, checked in) but not how they happened. The organizer cannot see when tickets sold, when people arrived at the door, or how much money came from EARLY versus LATE prices. Those answers matter for planning the next party (when to end early pricing, how many door staff to bring at what time).

## What
A CHARTS section on the organizer dashboard, for the active event, with three charts:

1. **Tickets sold per day.** PAID tickets counted on the Lisbon date they were confirmed (`paid_at`). Days between the first and last sale with no sales show as 0.
2. **Arrivals per 15 minutes.** Check-ins of paid tickets and non-paying guests, grouped into 15-minute slots in Lisbon time (18:00, 18:15...). Empty slots between the first and last arrival show as 0.
3. **Revenue by price tier.** For EARLY and LATE: number of PAID tickets and their revenue (using each ticket's actual amount, including manual adjustments). Paid tickets with no recorded tier appear as OTHER, only if there are any.

Each chart:
- has a title and a hover tooltip with the exact numbers;
- has a table view with the same numbers (for reading exact values and for screen readers);
- shows "No data yet." instead of an empty chart.

Only PAID tickets count as sales and revenue, as in the KPIs. The charts are on the organizer dashboard only (they show revenue), never on the door or public screens.

## Out of scope
- Charts for past (inactive) events.
- Bookings that were reserved or claimed but never paid.
- Downloading the charts.

## Done when
- `logic.sales_by_day()`, `logic.arrivals_by_quarter_hour()` and `logic.revenue_by_tier()` are covered by tests: only PAID counts, Lisbon dates and 15-minute slots (including the summer/winter clock change), gap-filling with zeros, adjusted amounts, OTHER tier, and empty input.
- `logic.dashboard()` returns the three series for the active event.
- A screen test sees the three charts on the organizer dashboard, and the door account cannot see them.
- `uv run pytest` is green.
