"""guest_list_pdf.py — draws the printable GUEST LIST (names only).

The organizer downloads this as a paper backup for the door. It lists PAID
and non-paying guests by last name, with page numbers. No emails, prices,
IDs or QR data appear in it. The list itself comes from logic.guest_list().
"""

from __future__ import annotations

from pathlib import Path

from fpdf import FPDF

import logic

FONTS = Path(__file__).parent / "assets" / "fonts"
INK = (11, 11, 11)
BLUE = (31, 92, 255)
LINE = (222, 222, 222)


def render(event: dict, guests: list[dict]) -> bytes:
    pdf = FPDF(format="A4", unit="pt")
    pdf.set_margins(42, 42, 42)
    pdf.set_auto_page_break(False)
    # DejaVu Sans covers accents such as ã, ç and é (Tubarão, João...).
    pdf.add_font("Body", "", str(FONTS / "DejaVuSans.ttf"))
    pdf.add_font("Body", "B", str(FONTS / "DejaVuSans-Bold.ttf"))
    pdf.set_title(f"{event['name']} | Guest List")

    width = pdf.w - 84
    date = logic.lisbon(event["starts_at"], "%A, %d %B %Y") + "  |  " if event["starts_at"] else ""
    digits = max(2, len(str(len(guests))))

    def header() -> None:
        pdf.add_page()
        pdf.set_text_color(*INK)
        pdf.set_font("Body", "B", 14)
        pdf.multi_cell(width, 18, event["name"], new_x="LMARGIN", new_y="NEXT")
        pdf.set_font("Body", "B", 23)
        pdf.cell(width, 30, "GUEST LIST", new_x="LMARGIN", new_y="NEXT")
        pdf.set_font("Body", "", 10)
        pdf.cell(width, 16, f"{date}Total Guests: {len(guests)}", new_x="LMARGIN", new_y="NEXT")
        y = pdf.get_y() + 8
        pdf.set_draw_color(*BLUE)
        pdf.set_line_width(0.7)
        pdf.line(42, y, 42 + width, y)
        pdf.set_y(y + 4)

    header()
    if not guests:
        pdf.set_font("Body", "", 11)
        pdf.cell(width, 20, "No guests to list.")
    pdf.set_font("Body", "", 11)
    for index, guest in enumerate(guests, start=1):
        if pdf.get_y() + 20 > pdf.h - 62:
            header()
            pdf.set_font("Body", "", 11)
        y = pdf.get_y()
        pdf.set_xy(42, y + 3)
        pdf.cell(40, 14, str(index).zfill(digits))
        pdf.set_xy(82, y + 3)
        pdf.multi_cell(width - 40, 14, f"{guest['last_name']} {guest['first_name']}", new_x="LMARGIN", new_y="NEXT")
        y = pdf.get_y() + 3
        pdf.set_draw_color(*LINE)
        pdf.set_line_width(0.35)
        pdf.line(42, y, 42 + width, y)
        pdf.set_y(y)

    pages = pdf.page_no()
    for page in range(1, pages + 1):
        pdf.page = page
        pdf.set_font("Body", "", 9)
        pdf.set_text_color(*INK)
        pdf.set_xy(42, pdf.h - 47)
        pdf.cell(width, 10, f"Page {page} of {pages}", align="R")
    return bytes(pdf.output())


def filename(event: dict) -> str:
    date = "_" + logic.lisbon(event["starts_at"], "%Y-%m-%d") if event["starts_at"] else ""
    return f"{logic._safe_filename(event['name'])}_Guest_List{date}.pdf"
