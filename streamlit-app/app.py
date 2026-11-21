"""app.py — the screens of Tubarão (Streamlit).

Run:   uv run streamlit run app.py

There are four screens, one function each:

    page_tickets()    public page: event, follow step, tickets, checkout   (guests)
    page_door()       QR scanner, name search, live attendance              (door staff + organizer)
    page_organizer()  payments, event settings, attendee lists, downloads   (organizer only)
    page_privacy()    the privacy notice

Screens only show things and collect clicks. Every rule (prices, capacity,
who may do what) is checked in logic.py, which saves through db.py.
"""

from __future__ import annotations

import html
import os
from datetime import date, datetime, time, timedelta
from pathlib import Path

import pandas as pd
import streamlit as st

import db
import guest_list_pdf
import logic
import seed
import tickets
from logic import TubaraoError

APP_DIR = Path(__file__).parent
LOGO = APP_DIR / "assets" / "tubarao-logo.jpeg"
STATUS_WORDS = {"AVAILABLE": "AVAILABLE", "FEW_TICKETS_LEFT": "FEW TICKETS LEFT", "SOLD_OUT": "SOLD OUT"}



# ==================================================================== setup and shared helpers

def load_secrets() -> None:
    """Copy Streamlit secrets (used when the app is deployed) into environment variables."""
    try:
        for key in ("TUBARAO_TICKET_SECRET", "TUBARAO_ORGANIZER_CODE", "TUBARAO_DOOR_CODE", "TUBARAO_DB"):
            if key in st.secrets and key not in os.environ:
                os.environ[key] = str(st.secrets[key])
    except Exception:  # no secrets file: that's fine locally
        pass


@st.cache_resource
def bootstrap() -> bool:
    """Runs once per server. On a brand-new deployment with no staff accounts,
    create the demo data if access codes were provided as secrets."""
    load_secrets()
    conn = db.connect()
    empty = not db.active_accounts(conn) and not db.all_events(conn)
    organizer, door = os.environ.get("TUBARAO_ORGANIZER_CODE"), os.environ.get("TUBARAO_DOOR_CODE")
    if empty and organizer and door:
        seed.seed(conn, organizer, door)
    conn.close()
    return True


def conn():
    """One database connection per browser session."""
    if "conn" not in st.session_state:
        bootstrap()
        st.session_state.conn = db.connect()
    return st.session_state.conn


def now() -> datetime:
    return logic.utcnow()


def esc(text) -> str:
    return html.escape(str(text))


def flash(kind: str, text: str) -> None:
    """Remember a message to show after the page reloads."""
    st.session_state.flash = (kind, text)


def show_flash() -> None:
    if "flash" in st.session_state:
        kind, text = st.session_state.pop("flash")
        getattr(st, kind)(text)


def act(action, *args, success: str | None = None, **kwargs):
    """Run a logic.py action, remember the outcome, and reload the page."""
    try:
        result = action(*args, **kwargs)
    except TubaraoError as error:
        flash("error", error.message)
    else:
        if success:
            flash("success", success)
        st.session_state.last_result = result
    reset_tables()
    st.rerun()


def reset_tables() -> None:
    """After a change, clear every table selection so no button acts on a row that moved."""
    st.session_state.table_round = st.session_state.get("table_round", 0) + 1
    st.session_state.pop("last_table", None)


def countdown_text(until: datetime) -> str:
    seconds = max(0, int((until - now()).total_seconds()))
    days, rest = divmod(seconds, 86400)
    hours, rest = divmod(rest, 3600)
    minutes, seconds = divmod(rest, 60)
    if days:
        return f"{days}d {hours:02d}:{minutes:02d}:{seconds:02d}"
    if hours:
        return f"{hours:02d}:{minutes:02d}:{seconds:02d}"
    return f"{minutes:02d}:{seconds:02d}"


def style() -> None:
    """Tubarão brand: black, bone white and Atlantic blue, with tall uppercase headings."""
    st.markdown("""
<style>
:root { --bone:#F3F0E8; --blue:#1F5CFF; --muted:rgba(243,240,232,.58); --line:rgba(243,240,232,.16); }
h1, h2, h3, .display { font-family: Impact, "Arial Narrow", sans-serif !important; text-transform: uppercase;
  letter-spacing: .02em; font-weight: 400 !important; }
.display { line-height: .9; margin: 0; }
.eyebrow { font-size: 12px; letter-spacing: .28em; text-transform: uppercase; color: var(--muted); }
.meta { display:flex; justify-content:center; gap:10px 22px; flex-wrap:wrap; font-size:13px;
  letter-spacing:.18em; text-transform:uppercase; color:var(--muted); }
.openbar { display:inline-block; border-bottom:3px solid var(--blue); padding-bottom:5px; font-weight:800;
  letter-spacing:.18em; text-transform:uppercase; }
.center { text-align:center; }
.card { border:1px solid var(--line); border-radius:18px; padding:20px 22px;
  background:linear-gradient(180deg,rgba(255,255,255,.045),rgba(255,255,255,.018)); margin-bottom:10px; }
.card.muted { opacity:.55; }
.kind { font-family: Impact, "Arial Narrow", sans-serif; text-transform:uppercase; font-size:31px; }
.price { font-size:17px; font-weight:700; margin:6px 0 10px; }
.status { font-size:11px; letter-spacing:.16em; text-transform:uppercase; color:var(--blue); font-weight:800; }
.big-timer { font-family: Impact, "Arial Narrow", sans-serif; font-size:64px; text-align:center; letter-spacing:.04em; }
.banner { border-radius:18px; padding:26px 18px; text-align:center; margin:8px 0 14px; color:white; }
.banner .display { font-size:46px; }
.banner p { margin:8px 0 0; font-size:18px; }
.banner.ok { background:#1F5CFF; } .banner.warn { background:#B7791F; } .banner.bad { background:#C93333; }
[data-testid="stHeaderActionElements"] { display:none; }  /* no link icons next to headings */
[data-testid="stImage"] img { mix-blend-mode: screen; }   /* logo's black blends into the page */
.pill { display:inline-block; padding:2px 10px; border-radius:999px; border:1px solid var(--line); font-size:12px;
  letter-spacing:.08em; }
</style>""", unsafe_allow_html=True)


# ==================================================================== staff sign-in

def staff_identity() -> dict | None:
    """Return the signed-in staff member, or show the ADMIN ACCESS form."""
    c = conn()
    identity = logic.session_identity(c, st.session_state.get("staff_token"), now())
    if identity:
        return identity
    st.session_state.pop("staff_token", None)
    st.markdown("<h1 class='center'>ADMIN ACCESS</h1>", unsafe_allow_html=True)
    if not db.active_accounts(c):
        st.warning("No staff accounts exist yet. In a terminal, run `uv run python seed.py` to create the demo "
                   "data and access codes.")
    with st.form("login"):
        code = st.text_input("Access code", type="password")
        if st.form_submit_button("ENTER", type="primary", width="stretch"):
            try:
                token, _identity = logic.login(c, code, now())
            except TubaraoError as error:
                st.error(error.message)
            else:
                st.session_state.staff_token = token
                st.rerun()
    return None


def staff_bar(identity: dict, title: str) -> None:
    left, right = st.columns([3, 2], vertical_alignment="center")
    left.markdown(f"<div class='eyebrow'>TUBARÃO · {esc(title)}</div>"
                  f"<div><b>{esc(identity['label'])}</b> · {esc(identity['role'])}</div>", unsafe_allow_html=True)
    with right:
        a, b = st.columns(2)
        if identity["role"] == "SUPER_ADMIN":
            other = PAGES["door"] if title != "CHECK-IN" else PAGES["organizer"]
            a.page_link(other, label="CHECK-IN" if title != "CHECK-IN" else "BACK TO ADMIN")
        if b.button("LOG OUT", width="stretch"):
            logic.logout(conn(), st.session_state.get("staff_token"), now())
            for key in ("staff_token", "scan_result", "manual_result"):
                st.session_state.pop(key, None)
            st.rerun()


# ==================================================================== public: tickets and checkout

def page_tickets() -> None:
    style()
    c = conn()
    st.image(str(LOGO), width="stretch")
    try:
        state = logic.public_state(c, now())
    except TubaraoError:
        st.markdown("<h2 class='center'>No event right now</h2>"
                    "<p class='center eyebrow'>Follow Tubarão for the next announcement.</p>", unsafe_allow_html=True)
        return

    if st.session_state.get("booking") and st.session_state.get("show_booking", True):
        booking_screen(state)
    elif st.session_state.get("checkout_category"):
        checkout_screen(state, st.session_state.checkout_category)
    else:
        landing_screen(state)


def landing_screen(state: dict) -> None:
    starts = state["starts_at"]
    st.markdown(
        f"<div class='center'><div class='eyebrow'>Carcavelos · Private garden</div>"
        f"<h1 class='display' style='font-size:clamp(48px,9vw,96px)'>{esc(state['name'])}</h1>"
        f"<div class='meta' style='margin-top:18px'><span>{logic.lisbon(starts, '%A, %d %B %Y')}</span>"
        f"<span>From {logic.lisbon(starts, '%H:%M')}</span></div>"
        f"<div class='openbar' style='margin-top:16px'>Open bar</div></div>", unsafe_allow_html=True)

    if st.session_state.get("booking"):
        st.info("You have a booking in progress.")
        if st.button("VIEW MY BOOKING", type="primary", width="stretch"):
            st.session_state.show_booking = True
            st.rerun()

    st.divider()
    st.markdown("<div class='eyebrow'>Step 01 · Before tickets</div><h2>Follow Tubarão.</h2>", unsafe_allow_html=True)
    st.write(f"Follow **{logic.INSTAGRAM_HANDLE}** on Instagram before buying. "
             "*Classroom demo: no link opens and nothing is checked.*")
    followed = st.checkbox(f"I follow {logic.INSTAGRAM_HANDLE}", key="follow_confirmed")
    if not followed:
        st.caption("Confirm the Instagram step to unlock tickets.")

    pricing = state["pricing"]
    st.markdown(f"<div class='eyebrow' style='margin-top:18px'>Tickets</div>"
                f"<h2>{pricing['phase']} TICKETS · {logic.public_price(pricing['current_price_cents'])}</h2>",
                unsafe_allow_html=True)
    if state["sales_status"] == "CLOSED":
        st.warning("TICKETS NOT CURRENTLY AVAILABLE")
    if pricing["show_countdown"] and pricing["early_price_ends_at"]:
        rises = pricing["next_price_cents"] and pricing["next_price_cents"] > pricing["current_price_cents"]
        price_countdown(pricing["early_price_ends_at"], "PRICE INCREASES IN" if rises else "PRICE CHANGES IN")

    columns = st.columns(2)
    for column, category in zip(columns, ("WOMEN", "MEN")):
        status = state[f"{category.lower()}_status"]
        with column:
            st.markdown(f"<div class='card'><div class='kind'>{category.title()} ticket</div>"
                        f"<div class='price'>{logic.public_price(pricing['current_price_cents'])}</div>"
                        f"<div class='status'>{STATUS_WORDS[status]}</div></div>", unsafe_allow_html=True)
            if st.button("GET TICKET →", key=f"get_{category}", type="primary", width="stretch",
                         disabled=not followed or status == "SOLD_OUT"):
                st.session_state.checkout_category = category
                st.rerun()

    if pricing["phase"] == "EARLY":
        later = (logic.public_price(pricing["next_price_cents"]) if pricing["show_late_price"]
                 and pricing["next_price_cents"] else "Available after early tickets end")
        st.markdown(f"<div class='card muted'><div class='eyebrow'>Next price</div>"
                    f"<div class='kind' style='font-size:22px'>Late tickets</div><div>{esc(later)}</div></div>",
                    unsafe_allow_html=True)
    st.caption("Tickets are individual and non-transferable.")

    with st.expander("Already reserved? Find your booking"):
        with st.form("find_booking"):
            reference = st.text_input("Booking reference")
            email = st.text_input("Email")
            if st.form_submit_button("FIND MY BOOKING"):
                try:
                    logic.reservation_state(conn(), reference, email, now())
                except TubaraoError as error:
                    st.error(error.message)
                else:
                    st.session_state.booking = {"reservation_id": reference.strip().lower(), "email": email}
                    st.session_state.show_booking = True
                    st.rerun()
    st.page_link(PAGES["privacy"], label="Privacy notice")


@st.fragment(run_every="1s")
def price_countdown(ends_iso: str, label: str) -> None:
    ends = logic.parse_time(ends_iso)
    if ends <= now():
        st.rerun()  # the price just changed: reload the whole page from the database
    st.markdown(f"<div class='eyebrow'>{label} <b>{countdown_text(ends)}</b></div>", unsafe_allow_html=True)


def checkout_screen(state: dict, category: str) -> None:
    if st.button("← Back"):
        st.session_state.pop("checkout_category")
        st.rerun()
    price = state["pricing"]["current_price_cents"]
    st.markdown(f"<h1>{category} TICKET</h1><div class='price'>{logic.public_price(price)}</div>", unsafe_allow_html=True)
    st.caption("The final price is the one locked into your reservation when you press RESERVE MY SPOT.")
    with st.form("checkout"):
        first_name = st.text_input("First name", max_chars=100)
        last_name = st.text_input("Last name", max_chars=100)
        email = st.text_input("Email", max_chars=254, placeholder="you@example.test")
        st.warning("Please select the correct ticket category. Tickets purchased under the wrong category may be "
                   "cancelled and refunded.")
        right_category = st.checkbox(f"I confirm my ticket category is {category}.")
        st.caption("Tickets are individual and non-transferable.")
        st.markdown("By continuing, you acknowledge that you have read our "
                    "<a href='privacy' target='_blank'>Privacy Notice</a>.", unsafe_allow_html=True)
        if st.form_submit_button("RESERVE MY SPOT", type="primary", width="stretch"):
            if not right_category:
                st.error("Confirm your ticket category to continue.")
                return
            try:
                result = logic.reserve(conn(), first_name, last_name, email, category, now())
            except TubaraoError as error:
                st.error(error.message)
                return
            st.session_state.booking = {"reservation_id": result["reservation_id"], "email": email}
            st.session_state.show_booking = True
            st.session_state.pop("checkout_category", None)
            if result.get("resumed"):
                flash("info", "Welcome back — this is your existing booking.")
            st.rerun()


BOOKING_COPY = {
    "RESERVED": ("YOUR SPOT IS RESERVED", "Complete your payment within {minutes} minutes."),
    "PAYMENT_CLAIMED": ("DEMO PAYMENT CLAIMED", "Your claim is awaiting admin review. The demo QR becomes available "
                        "to the admin after confirmation and issuance."),
    "PAID": ("DEMO PAYMENT CONFIRMED", "The admin confirmed your simulated payment. Ask the classroom event admin "
             "for your demo QR."),
    "EXPIRED": ("RESERVATION EXPIRED", "Your payment window has ended. Start again to check availability."),
    "REJECTED": ("PAYMENT REJECTED", "Your payment claim was rejected. No ticket has been issued."),
    "CANCELLED": ("RESERVATION CANCELLED", "This reservation is no longer active. No ticket has been issued."),
}


def booking_screen(state: dict) -> None:
    if st.button("← Back to the event"):
        st.session_state.show_booking = False
        st.rerun()
    show_flash()
    booking_panel(state["reservation_minutes"])


@st.fragment(run_every="2s")
def booking_panel(minutes: int) -> None:
    """Re-reads the booking from the database every 2 seconds, so the guest sees
    the organizer's decision without reloading."""
    booking = st.session_state.booking
    try:
        view = logic.reservation_state(conn(), booking["reservation_id"], booking["email"], now())
    except TubaraoError as error:
        st.error(error.message)
        return
    status = view["status"]
    heading, text = BOOKING_COPY.get(status, ("ORDER UNAVAILABLE", "Please try again."))
    st.markdown(f"<h1 class='center'>{heading}</h1>", unsafe_allow_html=True)
    st.markdown(f"<p class='center'>{esc(text.format(minutes=minutes))}</p>", unsafe_allow_html=True)
    st.markdown(f"<p class='center eyebrow'>{view['category']} · {logic.public_price(view['amount_cents'])}</p>",
                unsafe_allow_html=True)

    if status == "RESERVED":
        st.markdown(f"<div class='big-timer'>{countdown_text(logic.parse_time(view['reserved_until']))}</div>",
                    unsafe_allow_html=True)
        if st.button(f"SIMULATE {logic.public_price(view['amount_cents'])} & CLAIM", type="primary", width="stretch"):
            try:
                logic.claim_payment(conn(), booking["reservation_id"], booking["email"], now())
            except TubaraoError as error:
                st.session_state.claim_error = error.message
            st.rerun()
        st.caption("Classroom demo. No money moves.")
    if st.session_state.get("claim_error"):
        st.error(st.session_state.pop("claim_error"))
    if status in ("PAYMENT_CLAIMED", "PAID"):
        st.caption("Can’t find your ticket later? Check your spam or junk folder too. "
                   "If it’s still missing, contact the organizers.")
    if status in ("EXPIRED", "REJECTED", "CANCELLED"):
        if st.button("TRY AGAIN", type="primary", width="stretch"):
            for key in ("booking", "show_booking"):
                st.session_state.pop(key, None)
            st.rerun(scope="app")

    st.caption("Booking reference — keep it with your email to find this booking again:")
    st.code(view["reservation_id"], language=None)


def page_privacy() -> None:
    style()
    st.markdown("<h1>Privacy notice</h1>", unsafe_allow_html=True)
    st.write("Your details help us manage your ticket and welcome you at the door.")
    for title, text in [
        ("What we collect", "First name, last name, email, ticket category, reservation and payment status, and "
                            "ticket and check-in information."),
        ("How we use it", "To manage reservations, confirm payment, issue your ticket and QR code, manage event "
                          "access and check-in, and handle operational issues related to the event."),
        ("Who has access", "We do not sell your data. Access is limited to Tubarão organizers and authorized door "
                           "staff where needed. This classroom copy uses a local database and made-up records."),
        ("How long we keep it", "We retain data only for as long as reasonably necessary for event administration, "
                                "operational follow-up and applicable obligations, then delete or anonymize it "
                                "where appropriate."),
        ("Get in touch", f"Message {logic.INSTAGRAM_HANDLE} on Instagram. In the classroom demo, use made-up guest "
                         "information only."),
    ]:
        st.markdown(f"### {title}")
        st.write(text)
    st.page_link(PAGES["tickets"], label="BACK TO THE EVENT")


# ==================================================================== door: scanner, search, live attendance

def page_door() -> None:
    style()
    identity = staff_identity()
    if not identity:
        return
    staff_bar(identity, "CHECK-IN")
    try:
        event = logic.current_event(conn())
        st.markdown(f"<h2>{esc(event['name'])}</h2>", unsafe_allow_html=True)
    except TubaraoError as error:
        st.error(error.message)
        return

    scan_tab, search_tab = st.tabs(["SCAN QR", "FIND BY NAME"])
    with scan_tab:
        scanner(identity)
    with search_tab:
        manual_search(identity)
    st.divider()
    live_attendance(identity)


def result_banner(result: dict) -> None:
    kind = result["result"]
    name = esc(f"{result.get('first_name', '')} {result.get('last_name', '')}".strip())
    if kind == "CHECKED_IN":
        body, css = f"<p>{name}</p><p><b>{result['category']}</b></p>", "ok"
        title = "CHECKED IN"
    elif kind == "ALREADY_CHECKED_IN":
        body = (f"<p>{name}</p><p><b>{result['category']}</b></p>"
                f"<p>First check-in at {logic.lisbon(result['checked_in_at'], '%H:%M')}</p>")
        title, css = "ALREADY CHECKED IN", "warn"
    elif kind == "INVALID":
        title, body, css = "INVALID TICKET", "<p>Do not admit. Unknown, other-event or unpaid ticket.</p>", "bad"
    else:
        title, body, css = "CHECK NOT COMPLETED", f"<p>Do not admit. {esc(result.get('message', 'Try again.'))}</p>", "bad"
    st.markdown(f"<div class='banner {css}'><div class='display'>{title}</div>{body}</div>", unsafe_allow_html=True)


def run_check_in(action, *args) -> dict:
    try:
        return action(conn(), *args, now())
    except TubaraoError as error:
        return {"result": "ERROR", "message": error.message}
    except Exception:  # never let a technical failure look like an admission
        return {"result": "ERROR", "message": "Try again."}


def scanner(identity: dict) -> None:
    round_number = st.session_state.setdefault("scan_round", 0)
    if st.session_state.get("scan_result"):
        result_banner(st.session_state.scan_result)
        if st.button("SCAN NEXT", type="primary", width="stretch"):
            st.session_state.scan_result = None
            st.session_state.scan_round += 1
            st.rerun()
        return

    photo = st.camera_input("Point the camera at the ticket QR", key=f"camera_{round_number}")
    upload = st.file_uploader("…or upload a QR image", type=["png", "jpg", "jpeg"], key=f"upload_{round_number}")
    with st.form(f"paste_{round_number}", border=False):
        pasted = st.text_input("…or paste the ticket code", placeholder="TUBARAO:…")
        submitted = st.form_submit_button("CHECK CODE")
    st.caption("Camera use needs HTTPS (or localhost) and browser permission. If it is blocked, use FIND BY NAME.")

    payload = None
    image = photo or upload
    if image is not None:
        payload = tickets.decode_qr_image(image.getvalue())
        if payload is None:
            st.warning("No QR code found in that image. Hold the ticket closer and steady, then try again.")
            return
    elif submitted and pasted.strip():
        payload = pasted.strip()
    if payload is not None:
        st.session_state.scan_result = run_check_in(logic.check_in_qr, identity, payload)
        st.rerun()


def manual_search(identity: dict) -> None:
    if st.session_state.get("manual_result"):
        result_banner(st.session_state.manual_result)
        if st.button("DONE", width="stretch"):
            st.session_state.manual_result = None
            st.rerun()
    query = st.text_input("Search by first name, last name or email", key="door_query")
    if not query.strip():
        st.caption("Only paid tickets that have not checked in can be admitted here.")
        return
    try:
        found = logic.search_attendees(conn(), identity, query, now())
    except TubaraoError as error:
        st.error(error.message)
        return
    if not found["attendees"]:
        st.info("No matching bookings for this event.")
    for person in found["attendees"]:
        with st.container(border=True):
            left, right = st.columns([3, 1], vertical_alignment="center")
            status = "CHECKED IN " + logic.lisbon(person["checked_in_at"], "%H:%M") if person["checked_in_at"] else person["status"]
            left.markdown(f"**{esc(person['first_name'])} {esc(person['last_name'])}** · {person['category']}  \n"
                          f"{esc(person['email'])} · <span class='pill'>{esc(status)}</span>", unsafe_allow_html=True)
            if person["status"] == "PAID" and not person["checked_in_at"]:
                if right.button("CHECK IN", key=f"in_{person['reservation_id']}", type="primary", width="stretch"):
                    st.session_state.manual_result = run_check_in(logic.check_in_manual, identity, person["reservation_id"])
                    st.rerun()
    if found["more"]:
        st.caption("More matches exist. Type more of the name to narrow the list.")


@st.fragment(run_every="5s")
def live_attendance(identity: dict) -> None:
    """Refreshes every 5 seconds. If an update fails, the last list stays on screen."""
    st.markdown("<h3>LIVE ATTENDANCE</h3>", unsafe_allow_html=True)
    try:
        data = logic.presence(conn(), identity)
        st.session_state.last_presence = data
    except Exception:
        data = st.session_state.get("last_presence")
        st.warning("LIVE UPDATE UNAVAILABLE")
        if not data:
            return
    stats = data["stats"]
    a, b, c = st.columns(3)
    a.metric("TOTAL INSIDE", stats["total"])
    b.metric("MEN", stats["men"], f"{stats['men_percentage']}%", delta_color="off", delta_arrow="off")
    c.metric("WOMEN", stats["women"], f"{stats['women_percentage']}%", delta_color="off", delta_arrow="off")
    if not data["attendees"]:
        st.caption("Nobody has checked in yet.")
        return
    order = st.selectbox("Sort", ["Latest arrivals", "Last name", "First name"], key="presence_sort")
    people = list(data["attendees"])
    if order == "Latest arrivals":
        people.sort(key=lambda p: p["checked_in_at"], reverse=True)
    else:
        field = "last_name" if order == "Last name" else "first_name"
        people.sort(key=lambda p: p[field].casefold())
    st.dataframe(pd.DataFrame([{
        "Name": f"{p['first_name']} {p['last_name']}", "Category": p["category"], "Type": p["type"],
        "Checked in": logic.lisbon(p["checked_in_at"], "%H:%M"),
    } for p in people]), hide_index=True, width="stretch")


# ==================================================================== organizer dashboard

def page_organizer() -> None:
    style()
    identity = staff_identity()
    if not identity:
        return
    if identity["role"] != "SUPER_ADMIN":
        st.info("This is a door account. It can only use check-in.")
        st.page_link(PAGES["door"], label="Go to CHECK-IN")
        return
    staff_bar(identity, "ADMIN")
    show_flash()
    if st.button("REFRESH"):
        st.rerun()

    c = conn()
    data = logic.dashboard(c, identity, now())
    if data["event"] is None:
        st.warning("There is no active event. Create one below, then set it as active.")
        other_events(identity, None)
        return

    event = data["event"]
    active_event_summary(event, data["pricing"])
    kpi_panel(data)
    st.divider()
    payment_verification(identity, data)
    st.divider()
    edit_event(identity, event)
    other_events(identity, event)
    st.divider()
    paying_attendees(identity, data)
    non_paying_attendees(identity, data)
    st.divider()
    downloads(identity, event)


def active_event_summary(event: dict, pricing: dict) -> None:
    st.markdown(f"<div class='eyebrow'>Active event</div><h1>{esc(event['name'])}</h1>", unsafe_allow_html=True)
    st.write(f"**{logic.lisbon(event['starts_at'], '%A, %d %B %Y · %H:%M')}** · Sales **{event['sales_mode']}** · "
             f"Price now **{pricing['phase']} {logic.money(pricing['current_price_cents'])}**")


def kpi_panel(data: dict) -> None:
    k, cap = data["kpis"], data["capacity"]
    row1 = st.columns(4)
    row1[0].metric("PAID ATTENDEES", k["paid"])
    row1[1].metric("NON-PAYING ATTENDEES", k["non_paying"])
    row1[2].metric("TOTAL ATTENDEES", k["total"])
    row1[3].metric("REVENUE", logic.money(k["revenue_cents"]))
    row2 = st.columns(4)
    row2[0].metric("MEN", k["total_men"], f"{k['total_men_percent']} of total · {k['paid_men']} paid", delta_color="off", delta_arrow="off")
    row2[1].metric("WOMEN", k["total_women"], f"{k['total_women_percent']} of total · {k['paid_women']} paid",
                   delta_color="off", delta_arrow="off")
    row2[2].metric("PLACES IN USE", f"{cap['total']} / {cap['physical_capacity']}",
                   f"incl. live holds · {cap['paid_capacity']} sellable", delta_color="off", delta_arrow="off")
    row2[3].metric("MEN CAP", f"{cap['men']} / {cap['men_paid_cap']}", f"{k['checked_in']} paid checked in",
                   delta_color="off", delta_arrow="off")
    st.caption("Exact numbers are internal. The public page only ever shows AVAILABLE, FEW TICKETS LEFT or SOLD OUT.")


def _table(rows: list[dict], columns: dict, name: str):
    """Show rows as a table where one row can be selected. Returns the selected row or None."""
    if not rows:
        st.caption("Nothing here.")
        return None
    frame = pd.DataFrame([{label: make(row) for label, make in columns.items()} for row in rows])
    picked = st.dataframe(frame, hide_index=True, width="stretch", selection_mode="single-row",
                          on_select=lambda: st.session_state.update(last_table=name),
                          key=f"{name}_{st.session_state.get('table_round', 0)}")
    chosen = picked.selection.rows
    return rows[chosen[0]] if chosen and chosen[0] < len(rows) else None


REVIEW_ORDER = {"PAYMENT_CLAIMED": 0, "RESERVED": 1, "PAID": 2, "EXPIRED": 3, "REJECTED": 4, "CANCELLED": 5}


def payment_verification(identity: dict, data: dict) -> None:
    st.markdown("<h2>Payment verification</h2>", unsafe_allow_html=True)
    rows = data["reservations"]
    to_review = sorted([r for r in rows if not (r["status"] == "PAID" and r["ticket_issued_at"])],
                       key=lambda r: (REVIEW_ORDER.get(r["status"], 9), r["created_at"]))
    completed = sorted([r for r in rows if r["status"] == "PAID" and r["ticket_issued_at"]],
                       key=lambda r: r["ticket_issued_at"], reverse=True)
    columns = {
        "First name": lambda r: r["first_name"], "Last name": lambda r: r["last_name"], "Email": lambda r: r["email"],
        "Category": lambda r: r["category"], "Expected amount": lambda r: logic.money(r["amount_cents"]),
        "Status": lambda r: r["status"].replace("_", " "),
        "Reserved": lambda r: logic.lisbon(r["created_at"], "%d %b %H:%M"),
        "Claimed": lambda r: logic.lisbon(r["claimed_at"], "%d %b %H:%M"),
    }
    st.markdown("**TO REVIEW** — select a row to act on it")
    chosen = _table(to_review, columns, "review_table")
    with st.expander(f"COMPLETED / TICKETS ISSUED ({len(completed)})"):
        done = _table(completed, {**columns, "Issued": lambda r: logic.lisbon(r["ticket_issued_at"], "%d %b %H:%M"),
                                  "Checked in": lambda r: "YES" if r["checked_in_at"] else "NO"}, "completed_table")
    if done and (st.session_state.get("last_table") == "completed_table" or not chosen):
        chosen = done
    if chosen:
        reservation_actions(identity, chosen)


def reservation_actions(identity: dict, r: dict) -> None:
    c, secret = conn(), db.ticket_secret()
    with st.container(border=True):
        st.markdown(f"**{esc(r['first_name'])} {esc(r['last_name'])}** · {esc(r['email'])} · {r['category']} · "
                    f"expected **{logic.money(r['amount_cents'])}** ({r['pricing_tier'] or 'tier unknown'}) · "
                    f"<span class='pill'>{r['status'].replace('_', ' ')}</span>", unsafe_allow_html=True)
        buttons = st.columns(4)
        status, stored = r["status"], r["stored_status"]

        if status == "PAYMENT_CLAIMED":
            if buttons[0].button("CONFIRM PAID", type="primary", key="confirm"):
                confirm(logic.confirm_payment, identity, r["id"], secret)
            if buttons[1].button("REJECT", key="reject"):
                act(logic.reject_payment, c, identity, r["id"], now(), success="Claim rejected. The place is released.")
        elif status in ("RESERVED", "EXPIRED") and stored != "PAID":
            verified = st.checkbox("I verified this payment in Revolut (the guest did not claim it in time).",
                                   key=f"verified_{r['id']}")
            if buttons[0].button("CONFIRM PAID", type="primary", key="confirm_external", disabled=not verified):
                confirm(logic.confirm_external_payment, identity, r["id"], secret)
        elif status == "PAID":
            if r["ticket_issued_at"]:
                buttons[0].success("TICKET ISSUED")
                try:
                    png = logic.ticket_qr(c, identity, r["id"], secret)
                    buttons[1].download_button("DOWNLOAD DEMO QR", png, file_name=f"tubarao-ticket-{r['last_name']}.png",
                                               mime="image/png", key="qr_download", on_click="ignore")
                except TubaraoError as error:
                    buttons[1].error(error.message)
            else:
                buttons[0].warning(r["ticket_issue_error"] or "Ticket not issued yet.")
            label = "RETRY TICKET" if not r["ticket_issued_at"] else "RE-ISSUE (same QR)"
            if buttons[2].button(label, key="retry"):
                act(logic.retry_ticket, c, identity, r["id"], now(), secret, success="Ticket issued. Same QR as before.")

        if stored in logic.ACTIVE_STATUSES:
            if buttons[3].button("ADJUST AMOUNT", key="adjust"):
                adjust_amount_dialog(identity, r)
        if r["can_delete"]:
            if st.button("DELETE RECORD", key="delete_record"):
                delete_record_dialog(identity, r)


def confirm(action, identity, reservation_id, secret) -> None:
    try:
        result = action(conn(), identity, reservation_id, now(), secret)
    except TubaraoError as error:
        flash("error", error.message)
        st.rerun()
    if result["status"] == "EXPIRED":
        flash("warning", "The review window had already ended, so this booking is now EXPIRED. After verifying the "
                         "payment, select it again and use CONFIRM PAID to restore it (capacity is re-checked).")
    elif result.get("ticket_issued"):
        flash("success", "Payment confirmed. Demo ticket issued — find it under COMPLETED / TICKETS ISSUED "
                         "to DOWNLOAD DEMO QR.")
    else:
        flash("warning", f"Payment confirmed (PAID). {result.get('ticket_error') or 'Ticket not issued.'}")
    reset_tables()
    st.rerun()


@st.dialog("Adjust expected amount")
def adjust_amount_dialog(identity: dict, r: dict) -> None:
    st.write(f"**{r['first_name']} {r['last_name']}** · current amount **{logic.money(r['amount_cents'])}**")
    st.warning("This only changes the internal expected/revenue amount. No Revolut transfer, charge or refund happens.")
    text = st.text_input("New amount in euros", value=f"{r['amount_cents'] / 100:.2f}")
    left, right = st.columns(2)
    if left.button("CANCEL", width="stretch"):
        st.rerun()
    if right.button("SAVE AMOUNT", type="primary", width="stretch"):
        try:
            cents = logic.euros_to_cents(text)
        except TubaraoError as error:
            st.error(error.message)
            return
        act(logic.adjust_amount, conn(), identity, r["id"], cents, now(), success="Amount updated.")


@st.dialog("Delete record")
def delete_record_dialog(identity: dict, r: dict) -> None:
    st.write(f"**{r['first_name']} {r['last_name']}** · {r['email']} · {r['status']}")
    if r["status"] == "RESERVED":
        st.warning("This reservation is still holding a place. Deleting it releases the spot.")
    st.error("Deletion is permanent.")
    left, right = st.columns(2)
    if left.button("CANCEL", width="stretch"):
        st.rerun()
    if right.button("DELETE RECORD", type="primary", width="stretch"):
        act(logic.delete_record, conn(), identity, r["id"], success="Record deleted.")


# ---------------------------------------------------------------- event settings

def when_input(label: str, value: str | None, key: str, optional: bool = True, disabled: bool = False) -> datetime | None:
    """Date + time inputs in Lisbon time. Optional ones have a switch to leave them empty."""
    current = logic.parse_time(value).astimezone(logic.LISBON) if value else None
    enabled = True
    if optional:
        enabled = st.toggle(f"Set {label.lower()}", value=current is not None, key=f"{key}_on", disabled=disabled)
    default = current or datetime.combine(date.today() + timedelta(days=7), time(18, 0))
    left, right = st.columns(2)
    day = left.date_input(f"{label} — date", value=default.date(), key=f"{key}_d", disabled=disabled or not enabled)
    clock = right.time_input(f"{label} — time (Lisbon)", value=default.time().replace(second=0, microsecond=0),
                             key=f"{key}_t", step=300, disabled=disabled or not enabled)
    if not enabled:
        return None
    return datetime.combine(day, clock, tzinfo=logic.LISBON)


def event_form(event: dict | None, prefix: str) -> dict:
    """All event settings as inputs. Returns the values ready for logic.create_event / update_event."""
    base = event or logic.EVENT_DEFAULTS
    name = st.text_input("Event name", value=(event or {}).get("name", ""), key=f"{prefix}_name", max_chars=120)
    starts = when_input("Event start", base["starts_at"], f"{prefix}_start", optional=False)

    a, b, c, d = st.columns(4)
    capacity = a.number_input("Physical capacity (people)", 1, 100000, int(base["physical_capacity"]), key=f"{prefix}_cap")
    men_cap = b.number_input("MEN paid cap", 0, 100000, int(base["men_paid_cap"]), key=f"{prefix}_men")
    minutes = c.number_input("Reservation hold (minutes)", 1, 10000, int(base["reservation_minutes"]), key=f"{prefix}_min")
    hours = d.number_input("Claim review window (hours)", 1, 10000, int(base["claim_hold_hours"]), key=f"{prefix}_hours")

    st.markdown("**Pricing**")
    a, b, c = st.columns(3)
    early = a.text_input("EARLY price (€)", f"{base['early_price_cents'] / 100:.2f}", key=f"{prefix}_early")
    late = b.text_input("LATE price (€)", f"{base['late_price_cents'] / 100:.2f}", key=f"{prefix}_late")
    modes = ["AUTO", "EARLY", "LATE"]
    mode = c.selectbox("Pricing mode", modes, index=modes.index(base["pricing_mode"]), key=f"{prefix}_mode",
                       help="AUTO switches to LATE at the early deadline. EARLY/LATE force one price for new bookings.")
    early_ends = when_input("Early price deadline", base["early_price_ends_at"], f"{prefix}_ends", disabled=mode != "AUTO")
    if mode == "AUTO" and early_ends is None:
        st.caption("No deadline: EARLY price stays on indefinitely.")
    a, b = st.columns(2)
    show_countdown = a.checkbox("SHOW COUNTDOWN to the price change", bool(base["show_pricing_countdown"]), key=f"{prefix}_sc")
    show_late = b.checkbox("SHOW LATE PRICE during early sales", bool(base["show_late_price_before_start"]), key=f"{prefix}_sl")

    st.markdown("**Sales**")
    sales_modes = ["OPEN", "CLOSED", "SCHEDULED"]
    sales = st.radio("Sales mode", sales_modes, index=sales_modes.index(base["sales_mode"]), horizontal=True,
                     key=f"{prefix}_sales", help="OPEN ignores the schedule but never capacity.")
    scheduled = sales == "SCHEDULED"
    opens = when_input("Sales open", base["sales_open_at"], f"{prefix}_open", optional=False, disabled=not scheduled)
    closes = when_input("Sales close", base["sales_close_at"], f"{prefix}_close", disabled=not scheduled)

    def cents(text):
        try:
            return logic.euros_to_cents(text)
        except TubaraoError:
            return -1  # validate_event will reject it with a clear message

    return {
        "name": name, "starts_at": starts, "physical_capacity": int(capacity), "men_paid_cap": int(men_cap),
        "reservation_minutes": int(minutes), "claim_hold_hours": int(hours),
        "early_price_cents": cents(early), "late_price_cents": cents(late), "pricing_mode": mode,
        "early_price_ends_at": early_ends if mode == "AUTO" else base["early_price_ends_at"],
        "show_pricing_countdown": show_countdown, "show_late_price_before_start": show_late,
        "sales_mode": sales,
        "sales_open_at": opens if scheduled else base["sales_open_at"],
        "sales_close_at": closes if scheduled else base["sales_close_at"],
    }


def edit_event(identity: dict, event: dict) -> None:
    with st.expander("EDIT EVENT · sales, prices and capacity", expanded=False):
        prefix = f"edit_{event['id']}_{event['updated_at']}"  # fresh inputs after every save
        values = event_form(event, prefix)
        forced = values["pricing_mode"] != "AUTO" and values["pricing_mode"] != event["pricing_mode"]
        agreed = True
        if forced:
            agreed = st.checkbox(f"I understand FORCE {values['pricing_mode']} applies to every new booking. "
                                 "Existing bookings keep their price.", key=f"{prefix}_force")
        st.caption("Existing bookings keep their locked price and deadline. Capacity and the MEN cap can't go below "
                   "places already taken.")
        if st.button("SAVE EVENT", type="primary", disabled=not agreed, key=f"{prefix}_save"):
            act(logic.update_event, conn(), identity, event["id"], values, now(), success="Event saved.")


def other_events(identity: dict, event: dict | None) -> None:
    events = logic.list_events(conn(), identity)
    inactive = [e for e in events if not e["is_active"]]
    with st.expander(f"OTHER EVENTS ({len(inactive)})", expanded=event is None):
        if inactive:
            st.dataframe(pd.DataFrame([{"Name": e["name"], "Date": logic.lisbon(e["starts_at"]),
                                        "Sales": e["sales_mode"], "Created": logic.lisbon(e["created_at"])}
                                       for e in inactive]), hide_index=True, width="stretch")
            names = {f"{e['name']} · {logic.lisbon(e['starts_at'])}": e for e in inactive}
            picked = names[st.selectbox("Event to activate", list(names))]
            sure = st.checkbox(f"Make “{picked['name']}” the active event. Finish the current door session first.",
                               key="activate_sure")
            if st.button("SET AS ACTIVE EVENT", disabled=not sure):
                act(logic.activate_event, conn(), identity, picked["id"], now(), success=f"{picked['name']} is now active.")
        st.markdown("**CREATE NEW EVENT** — it starts inactive, so guests see nothing until you activate it.")
        values = event_form(None, f"new_{st.session_state.get('new_event_round', 0)}")
        if st.button("CREATE EVENT", type="primary"):
            st.session_state.new_event_round = st.session_state.get("new_event_round", 0) + 1
            act(logic.create_event, conn(), identity, values, now(), success="Event created (inactive).")


# ---------------------------------------------------------------- attendee lists

SORTS = {
    "First name": lambda r: (r["first_name"].casefold(), r["last_name"].casefold()),
    "Last name": lambda r: (r["last_name"].casefold(), r["first_name"].casefold()),
    "MEN first": lambda r: (r["category"] != "MEN", r["last_name"].casefold()),
    "WOMEN first": lambda r: (r["category"] != "WOMEN", r["last_name"].casefold()),
    "Checked in first": lambda r: (r["checked_in_at"] is None, r["last_name"].casefold()),
    "Not checked in first": lambda r: (r["checked_in_at"] is not None, r["last_name"].casefold()),
}


def paying_attendees(identity: dict, data: dict) -> None:
    st.markdown("<h2>Paying attendees</h2>", unsafe_allow_html=True)
    paid = [r for r in data["reservations"] if r["status"] == "PAID"]
    a, b, c = st.columns(3)
    first = a.text_input("First name", key="pf_first").strip().casefold()
    last = b.text_input("Last name", key="pf_last").strip().casefold()
    email = c.text_input("Email", key="pf_email").strip().casefold()
    a, b, c = st.columns(3)
    category = a.selectbox("Category", ["All", "WOMEN", "MEN"], key="pf_cat")
    checked = b.selectbox("Status", ["All", "Checked in", "Paid / Not checked in"], key="pf_status")
    sort = c.selectbox("Sort by", list(SORTS), key="pf_sort")
    rows = [r for r in paid if first in r["first_name"].casefold() and last in r["last_name"].casefold()
            and email in r["email"].casefold() and category in ("All", r["category"])
            and (checked == "All" or (checked == "Checked in") == bool(r["checked_in_at"]))]
    rows.sort(key=SORTS[sort])
    st.caption(f"{len(rows)} of {len(paid)} paid guests")
    chosen = _table(rows, {
        "First name": lambda r: r["first_name"], "Last name": lambda r: r["last_name"], "Email": lambda r: r["email"],
        "Category": lambda r: r["category"],
        "Check-in": lambda r: "Checked in " + logic.lisbon(r["checked_in_at"], "%H:%M") if r["checked_in_at"] else "Paid / Not checked in",
        "Ticket": lambda r: "ISSUED" if r["ticket_issued_at"] else "NOT ISSUED",
    }, "paying_table")
    if chosen:
        with st.container(border=True):
            st.write(f"**{chosen['first_name']} {chosen['last_name']}** · {chosen['category']} · "
                     f"{logic.money(chosen['amount_cents'])}")
            a, b = st.columns(2)
            if not chosen["checked_in_at"]:
                if a.button("CHANGE CATEGORY", key="change_cat"):
                    change_category_dialog(identity, chosen)
                if b.button("DELETE PAID TICKET", key="delete_paid"):
                    delete_paid_dialog(identity, chosen)
            else:
                st.caption("Checked-in tickets can't change category or be deleted.")


@st.dialog("Change ticket category")
def change_category_dialog(identity: dict, r: dict) -> None:
    st.write(f"**{r['first_name']} {r['last_name']}** is currently **{r['category']}**.")
    st.caption("The price, payment and QR stay the same. No email is sent.")
    new = st.radio("Category", ["WOMEN", "MEN"], index=["WOMEN", "MEN"].index(r["category"]), horizontal=True)
    left, right = st.columns(2)
    if left.button("CANCEL", width="stretch"):
        st.rerun()
    if right.button("SAVE", type="primary", width="stretch"):
        act(logic.change_paid_category, conn(), identity, r["id"], new, now(), success="Category updated.")


@st.dialog("Delete paid ticket")
def delete_paid_dialog(identity: dict, r: dict) -> None:
    st.write(f"**{r['first_name']} {r['last_name']}** · {r['email']} · {r['category']} · "
             f"expected {logic.money(r['amount_cents'])}")
    st.error("This permanently deletes the ticket. Its QR stops working and the place is released. "
             "Use it only for an accidentally confirmed duplicate. No email is sent.")
    left, right = st.columns(2)
    if left.button("CANCEL", width="stretch"):
        st.rerun()
    if right.button("DELETE TICKET", type="primary", width="stretch"):
        act(logic.delete_paid_ticket, conn(), identity, r["id"], success="Paid ticket deleted.")


def non_paying_attendees(identity: dict, data: dict) -> None:
    people, event = data["non_paying"], data["event"]
    with st.expander(f"NON-PAYING ATTENDEES ({len(people)})"):
        st.caption("Residents and invited guests take a physical place but create no sales or revenue.")
        chosen = _table(people, {
            "First name": lambda r: r["first_name"], "Last name": lambda r: r["last_name"],
            "Category": lambda r: r["category"],
            "Checked in": lambda r: logic.lisbon(r["checked_in_at"], "%H:%M") if r["checked_in_at"] else "—",
        }, "non_paying_table")
        if chosen and st.button(f"REMOVE {chosen['first_name']} {chosen['last_name']}"):
            remove_non_paying_dialog(identity, event["id"], chosen)
        with st.form("add_non_paying", clear_on_submit=True):
            a, b, c, d = st.columns(4)
            first = a.text_input("First name")
            last = b.text_input("Last name")
            email = c.text_input("Email (optional)")
            category = d.selectbox("Category", ["MEN", "WOMEN"])
            if st.form_submit_button("ADD NON-PAYING ATTENDEE"):
                act(logic.add_non_paying, conn(), identity, event["id"], first, last, category, email, now(),
                    success="Non-paying attendee added.")


@st.dialog("Remove non-paying attendee")
def remove_non_paying_dialog(identity: dict, event_id: str, person: dict) -> None:
    st.write(f"Remove **{person['first_name']} {person['last_name']}**? Their place is released.")
    left, right = st.columns(2)
    if left.button("CANCEL", width="stretch"):
        st.rerun()
    if right.button("REMOVE", type="primary", width="stretch"):
        act(logic.remove_non_paying, conn(), identity, event_id, person["id"], success="Removed.")


# ---------------------------------------------------------------- downloads

def downloads(identity: dict, event: dict) -> None:
    st.markdown("<h2>Downloads</h2>", unsafe_allow_html=True)
    st.caption("Emergency backups for the door. They may go out of date and are not proof of payment. "
               "Keep them private and delete them after the event.")

    # The files are only built when the button is pressed, using a separate connection.
    def backup_csv():
        separate = db.connect()
        try:
            return logic.event_backup_csv(separate, identity)[1]
        finally:
            separate.close()

    def guest_pdf():
        separate = db.connect()
        try:
            listed_event, guests = logic.guest_list(separate, identity)
            return guest_list_pdf.render(listed_event, guests)
        finally:
            separate.close()

    a, b = st.columns(2)
    a.download_button("DOWNLOAD EVENT BACKUP (CSV)", backup_csv, file_name=logic.backup_filename(event), mime="text/csv",
                      on_click="ignore")
    b.download_button("DOWNLOAD GUEST LIST (PDF)", guest_pdf, file_name=guest_list_pdf.filename(event),
                      mime="application/pdf", on_click="ignore")


# ==================================================================== navigation

def build_pages(default: str = "tickets") -> dict:
    screens = {
        "tickets": (page_tickets, "Tickets", ":material/confirmation_number:", "tickets"),
        "door": (page_door, "Door check-in", ":material/qr_code_scanner:", "checkin"),
        "organizer": (page_organizer, "Organizer", ":material/dashboard:", "admin"),
        "privacy": (page_privacy, "Privacy notice", ":material/shield:", "privacy"),
    }
    return {key: st.Page(screen, title=title, icon=icon, url_path=path, default=key == default)
            for key, (screen, title, icon, path) in screens.items()}


PAGES = build_pages()


def main(default: str = "tickets") -> None:
    """Start the app. Tests can open a different first screen with main("door")."""
    PAGES.update(build_pages(default))
    page = st.navigation(list(PAGES.values()))
    # The organizer dashboard uses the full screen width; the other screens are phone-first.
    wide = page.url_path == PAGES["organizer"].url_path
    st.set_page_config(page_title="Tubarão", page_icon=str(LOGO), layout="wide" if wide else "centered")
    page.run()


if __name__ == "__main__":
    main()
