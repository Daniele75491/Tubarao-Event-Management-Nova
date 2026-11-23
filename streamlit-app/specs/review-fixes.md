# Fixes from the PR #1 review

Daniele's review of the Python + Streamlit port found six problems. Each one below has a test that failed before the fix.

## 1. Expired bookings are saved as EXPIRED
**Why:** the app worked out "expired" on the fly (`logic.effective_status`) but saved it only during a few actions. Anything reading the saved status, such as the backup CSV, could show an expired hold as RESERVED.
**What:** whenever the active event's bookings are read (public page, guest booking view, door search, dashboard, backup CSV), every hold or claim whose time has run out is first saved as EXPIRED, with `expired_at` set to the moment its time ran out. This happens inside the same transaction, so two screens doing it at once cannot clash.
**Done when:** after a hold's time passes, the saved status is EXPIRED after each of those reads, and the backup CSV says EXPIRED.

## 2. First-time setup and `seed.py` are all-or-nothing
**Why:** on a new hosted copy, the app creates the first two accounts and the demo data in many separate steps. If one step failed, the database was left half-built. Because it was no longer empty, setup never ran again. `seed.py` also deleted the database before checking anything, without asking.
**What:**
- Both staff codes are checked before anything is written: at least 8 characters each, and different from each other.
- All demo data is created in one transaction: either all of it exists afterwards, or none of it does.
- `seed.py` asks before replacing an existing database (`--yes` skips the question). It builds the new database in a separate file and only then swaps it in, so a failure leaves the old database untouched. If the app is still running and holding the file (common on Windows), it says to stop the app first.
**Done when:** invalid or identical codes write nothing; a failure partway through setup leaves the database empty; a failed reset leaves the old database as it was.

## 3. Staff sessions are rechecked on every action
**Why:** each action checked that the staff *account* was still active, but not that the *session* was still valid. After LOG OUT, a session expiring, or a session being revoked, an already-open popup could still act, and LIVE ATTENDANCE kept refreshing.
**What:** the signed-in identity carries its session token, and `logic.require_role` checks that session on every action. It must exist, not be revoked or expired, and belong to that account. When it fails, the screen signs the person out and shows the access-code form. LIVE ATTENDANCE stops showing names straight away instead of keeping the last list.
**Done when:** every organizer and door action is refused with a revoked or expired session, and the screen test shows the sign-in form after the session is revoked.

## 4. Organizer actions use booking IDs, not row positions
**Why:** tables picked a booking by its position in the list. If the list changed between showing and clicking (for example, another phone confirmed a payment), an action could land on a different booking.
**What:** a selection is remembered as the booking's ID, taken from the list the organizer was actually looking at. If the list changes, the selection is cleared rather than moved to another row. A selected booking that no longer exists is simply not shown.
**Done when:** tests show that a changed list never turns a selection into a different booking.

## 5. QR codes always scan
**Why:** about 3 in 100 generated ticket QR codes could not be read by the scanner. Testing showed the cause is OpenCV's standard QR reader itself, not the codes: raising the error-correction level made no difference, while OpenCV's second reader (`QRCodeDetectorAruco`) read every one.
**What:** the scanner tries the second reader first, then the standard one, on the original image and on cleaned-up versions (greyscale, black-and-white, extra white border, enlarged). The QR images themselves don't change, so tickets already issued keep working and re-issuing still gives the same image.
**Done when:** 500 generated QR codes all scan at full size, at half size, slightly rotated, and photographed slightly blurred; images without a QR still return nothing.

## 6. Windows setup is documented
**Why:** setting up on Windows tripped twice: `uv` was missing, and the first test run was slow enough to time out.
**What:** the README has a Windows section (installing `uv` with `winget`, PowerShell commands, and why the first run is slow). Screen tests allow up to 2 minutes per screen.
