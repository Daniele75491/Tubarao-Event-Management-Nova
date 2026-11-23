"""selection.py — which row of an organizer table is selected, remembered by booking ID.

Streamlit tables report a selection as a row *position* (row 0, row 1...). If the
list changes between showing it and clicking (another phone confirms a payment,
a hold expires), the same position can point at a different booking. So:

1. When a row is clicked, its position is turned into an ID straight away, using
   the list that was on screen at that moment (`remember`).
2. Each table's widget key includes the list of IDs it shows (`widget_key`), so a
   changed list gets a fresh table with nothing highlighted.
3. When the list changes, the remembered ID is cleared too (`prepare`), so a
   button can never act on a booking the organizer didn't pick.
4. The selected row is looked up by ID in the current list (`chosen`).

`state` is st.session_state in the app and a plain dict in the tests.
"""

from __future__ import annotations

import hashlib


def widget_key(name: str, ids: list[str], round_: int) -> str:
    digest = hashlib.sha1("|".join(ids).encode("utf-8")).hexdigest()[:12]
    return f"{name}_{round_}_{digest}"


def prepare(state, name: str, ids: list[str], round_: int) -> str:
    """Call before drawing a table. Returns the widget key to use for it."""
    key = widget_key(name, ids, round_)
    if state.get(f"{name}__key") != key:  # the list changed (or a change was just made): start fresh
        state[f"{name}__key"] = key
        state.pop(f"{name}__selected", None)
    state[f"{name}__shown"] = list(ids)  # what is on screen now, for turning a click into an ID
    return key


def remember(state, name: str, shown_ids: list[str], positions: list[int]) -> None:
    """A click: turn the clicked position into the ID of the row that was on screen."""
    position = positions[0] if positions else None
    if position is not None and 0 <= position < len(shown_ids):
        state[f"{name}__selected"] = shown_ids[position]
    else:
        state.pop(f"{name}__selected", None)


def on_click(state, name: str, key: str) -> None:
    """Streamlit callback: read the clicked positions from the table widget and remember the ID."""
    widget = state.get(key)
    positions = list(widget["selection"]["rows"]) if widget else []
    remember(state, name, state.get(f"{name}__shown", []), positions)
    state["last_table"] = name


def chosen(state, name: str, rows: list[dict]) -> dict | None:
    """The selected row, found by its ID in the current list (None if nothing is selected or it's gone)."""
    selected = state.get(f"{name}__selected")
    return next((row for row in rows if row["id"] == selected), None) if selected else None
