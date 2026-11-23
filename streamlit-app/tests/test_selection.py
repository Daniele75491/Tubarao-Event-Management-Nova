"""Fix 4: a table selection is remembered as a booking ID, never as a row position."""

import selection


def rows(*ids):
    return [{"id": i, "name": i.upper()} for i in ids]


def click(state, name, shown, position):
    """What happens when the organizer clicks a row: positions come from the list they were looking at."""
    selection.remember(state, name, [r["id"] for r in shown], [position])


def show(state, name, current):
    """What the next page run does: pick the selected row (by ID) from the current list."""
    selection.prepare(state, name, [r["id"] for r in current], round_=0)
    return selection.chosen(state, name, current)


def test_a_click_selects_that_booking():
    state = {}
    listed = rows("a", "b", "c")
    show(state, "t", listed)
    click(state, "t", listed, 1)
    assert show(state, "t", listed)["id"] == "b"


def test_a_new_booking_above_does_not_move_the_selection_to_another_booking():
    state = {}
    before = rows("a", "b", "c")
    show(state, "t", before)
    click(state, "t", before, 1)            # organizer picked "b" (row 2)
    after = rows("new", "a", "b", "c")       # another phone added a booking at the top
    picked = show(state, "t", after)
    assert picked is None or picked["id"] == "b"  # never "a", which is now in row 2


def test_a_changed_list_clears_the_selection():
    state = {}
    before = rows("a", "b", "c")
    show(state, "t", before)
    click(state, "t", before, 1)
    assert show(state, "t", rows("a", "c")) is None   # "b" moved to another table (e.g. confirmed)


def test_a_click_on_a_list_that_changed_meanwhile_uses_what_was_on_screen():
    state = {}
    seen = rows("a", "b", "c")
    show(state, "t", seen)
    # Before the click is processed, the list behind it changes; the click still means "b".
    click(state, "t", seen, 1)
    assert show(state, "t", rows("b", "c"))  is None or show(state, "t", rows("b", "c"))["id"] == "b"


def test_a_click_outside_the_list_selects_nothing():
    state = {}
    listed = rows("a")
    show(state, "t", listed)
    click(state, "t", listed, 5)
    assert show(state, "t", listed) is None


def test_the_widget_key_changes_when_the_list_changes():
    assert selection.widget_key("t", ["a", "b"], 0) == selection.widget_key("t", ["a", "b"], 0)
    assert selection.widget_key("t", ["a", "b"], 0) != selection.widget_key("t", ["b", "a"], 0)
    assert selection.widget_key("t", ["a", "b"], 0) != selection.widget_key("t", ["a", "b"], 1)


def test_tables_do_not_share_selections():
    state = {}
    listed = rows("a", "b")
    show(state, "one", listed)
    show(state, "two", listed)
    click(state, "one", listed, 0)
    assert show(state, "one", listed)["id"] == "a" and show(state, "two", listed) is None
