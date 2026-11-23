"""The organizer's backup CSV and printable guest list."""

import csv
import io
import re

import guest_list_pdf
import logic
from conftest import NOW


def read_csv(data: bytes) -> list[list[str]]:
    return list(csv.reader(io.StringIO(data.decode("utf-8-sig"))))


def test_backup_lists_bookings_and_non_paying_guests_without_ids(conn, organizer, event, book, paid):
    logic.add_non_paying(conn, organizer, event["id"], "Rui", "Resident", "MEN", None, NOW)
    ticket = paid("WOMEN", first="Ana")
    book("MEN", first="Bruno")
    filename, data = logic.event_backup_csv(conn, organizer)
    rows = read_csv(data)
    assert rows[0] == logic.BACKUP_COLUMNS
    assert {row[0] for row in rows[1:]} == {"Ana", "Bruno", "Rui"}
    assert data.startswith("\ufeff".encode("utf-8"))  # Excel-friendly
    assert ticket["reservation_id"] not in data.decode("utf-8") and event["id"] not in data.decode("utf-8")
    assert filename.startswith("Tubarao_Test_Party") and filename.endswith("_backup.csv")


def test_backup_neutralises_spreadsheet_formulas(conn, organizer, event, book):
    book(first="=HYPERLINK(\"x\")", last="+SUM(1)")
    rows = read_csv(logic.event_backup_csv(conn, organizer)[1])
    assert rows[1][0].startswith("'=") and rows[1][1].startswith("'+")


def test_guest_list_has_paid_and_non_paying_guests_sorted_by_last_name(conn, organizer, event, book, paid):
    logic.add_non_paying(conn, organizer, event["id"], "Rui", "Almeida", "MEN", None, NOW)
    paid(first="Ana", last="Silva")
    paid(first="João", last="Costa")
    book(first="Not", last="Paid")
    _event, guests = logic.guest_list(conn, organizer)
    assert [g["last_name"] for g in guests] == ["Almeida", "Costa", "Silva"]


def test_guest_list_pdf_is_a_real_pdf_with_accents(conn, organizer, event, paid):
    paid(first="João", last="Conceição")
    listed_event, guests = logic.guest_list(conn, organizer)
    pdf = guest_list_pdf.render(listed_event, guests)
    assert pdf.startswith(b"%PDF")
    assert guest_list_pdf.filename(listed_event).endswith(".pdf")


def test_guest_list_pdf_handles_many_pages_and_no_guests(conn, organizer, event):
    assert guest_list_pdf.render(event, []).startswith(b"%PDF")
    many = [{"first_name": f"Guest{n}", "last_name": "Demo"} for n in range(120)]
    pages = len(re.findall(rb"/Type\s*/Page\b", guest_list_pdf.render(event, many)))
    assert pages >= 3  # about 40 names fit on a page
