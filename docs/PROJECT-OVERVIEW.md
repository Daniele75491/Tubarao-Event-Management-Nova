# Project Overview

Tubarão follows one simple question from start to finish. Who has a place at the event, and who has already arrived? The classroom demo lets us explore that problem with made-up guests and pretend payments.

The first Tubarão parties used WhatsApp invitations and direct transfers. As invitations spread, it became hard to tell who had paid on time, how many places were left, and who should be let in. The website was built to give guests and organizers one clear way to book a place and check it at the door.

## Who uses the app

The guest, the organizer, and door staff have different jobs. Their screens show the information they need for those jobs.

| Person | What they do |
| --- | --- |
| Guest | Chooses a ticket, holds a place, and submits a pretend payment claim. |
| Organizer (`SUPER_ADMIN`) | Sets up events and prices, reviews claims, and downloads confirmed tickets. |
| Door staff (`ADMIN`) | Looks up guests, checks tickets, and sees who has arrived. |

Organizers and door staff sign in with access codes. A guest can reserve without creating an account.

## What you can do today

The demo includes the screens and tools needed to run a practice event. Use different roles to see how the same event looks from checkout, the organizer’s dashboard, and the door.

| Area | What’s available |
| --- | --- |
| Guest checkout | Practice the social follow step, choose a ticket category, reserve, and submit a pretend payment claim. You can resume a booking after a refresh or by re-entering matching details. The public page shows availability without revealing exact counts. |
| Event setup | Create or switch events, schedule sales, choose early and late prices, control the price display, and set capacity and hold times. Keep a separate list for non-paying guests. |
| Claims and tickets | Confirm or reject claims, recover eligible bookings, download confirmed QR tickets, and retry failed ticket creation. Organizers can correct amounts or categories and remove eligible unused duplicates. |
| Organizer dashboard | Search and filter guests, see paid and non-paying totals and demo revenue, and download a spreadsheet backup (CSV) or names-only guest list (PDF). |
| Door and attendance | Scan a ticket or check in a paid guest by hand. See who has already arrived and catch attempts to use the same ticket twice. |

## How a booking becomes a ticket

A reservation holds a place while the guest completes checkout. The organizer then reviews the claim before the guest can use a ticket.

```text
Guest reserves a place
        ↓
Guest submits a pretend payment claim
        ↓
Organizer confirms the claim and downloads the ticket
        ↓
Door staff scans the ticket or checks in the guest by name
```

Imagine Alex reserves a ticket at 18:00 and has until 18:20 to submit a claim. If Alex misses that deadline, the place becomes available again. If Alex submits the claim on time, the organizer has a separate review window. Rejecting the claim or letting that window end also releases the place. The event settings decide how long each window lasts.

After confirmation, the organizer can download a QR code, the square image used for scanning. If the scanner is unavailable, staff can find an unused paid ticket and check it in by hand. A second attempt shows that the guest has already arrived.

## How the app handles places and prices

The event has a limit on how many people can fit. The app counts holds that are still valid, confirmed tickets, and people on the non-paying guest list so it can keep space for each of them. One ticket category can also have its own limit.

For example, if a practice event has room for 30 people and four places are set aside for non-paying guests, up to 26 places are available for paid tickets. Guests see a message such as **FEW TICKETS LEFT**. Organizers can see the exact numbers.

An event can have an early price and a later price. If Alex reserves at €8 and the price later rises to €12, the reservation keeps its €8 price. An organizer can make a deliberate correction when needed, and the app records who changed the amount.

## Where the app remembers things

The website sends requests to a program on the same computer. That program checks the rules and reads or saves information in a database, an organized store for events, reservations, and check-ins. The database is how checkout and the door screen can agree about the same ticket.

The app can remember enough information in the browser to find a reservation after a refresh. It checks the saved reservation with the program before showing its current status.

## How Tubarão developed

The project grew as the organizers needed a better way to handle each part of the event. The classroom copy keeps that workflow so the team can study and improve it with practice data.

1. **From messages to a website.** The first website brought event information and booking into one place.
2. **From a prototype to shared records.** The app added a database so checkout and staff could use the same reservations, prices, and capacity rules.
3. **From bookings to door tools.** Staff access codes, ticket QR codes, and single-use check-in helped separate organizer and door duties. Later updates added event settings, booking recovery, price options, and ways to correct eligible records.
4. **From the original app to the Nova classroom copy.** The November 2026 classroom project kept the workflow and replaced live payments and email with pretend claims and local QR downloads.

The [technical history](TECHNICAL-HISTORY.md) gives the implementation details. The [demo isolation record](NOVA-DEMO.md) records the classroom changes.

## A first team activity

Take turns using the three roles and compare what each person can see. Try refreshing checkout after submitting a claim, scanning a ticket twice, or finding a paid guest by name. Write down what you expected and what you saw. Those notes can become a useful bug report or a test case.

When you’re ready to find the code behind a screen or run the project, use the [Developer Guide](TECHNICAL.md).
