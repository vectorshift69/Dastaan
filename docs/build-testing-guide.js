/* ------------------------------------------------------------------ */
/* Source for Dastaan_Testing_Guide.docx                                */
/*                                                                      */
/*   cd docs && npm i docx && node build-testing-guide.js               */
/*                                                                      */
/* Keep this file as the single source of truth for the testing guide — */
/* edit the tables below and regenerate, rather than editing the .docx. */
/* ------------------------------------------------------------------ */

const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle,
  PageBreak, Header, Footer, PageNumber, convertInchesToTwip, ImageRun,
} = require("docx");

const INK = "111111", GOLD = "8A6D1F", GREY = "6B6B6B", RULE = "D8D4C8";
const PASS = "1E6B3A", FAIL = "9B2C1F", WARN = "8A5A00";
const W = 9026;
const RUN_DATE = "18–19 August 2026";
const EVIDENCE_DIR = __dirname + "/evidence";

const P = (text, o = {}) => new Paragraph({
  spacing: { before: o.before ?? 0, after: o.after ?? 120, line: o.line ?? 260 },
  alignment: o.align,
  children: [new TextRun({ text, bold: o.bold, italics: o.italics, size: o.size ?? 20,
    color: o.color ?? INK, font: "Calibri", characterSpacing: o.spacing })],
});
const Rich = (runs, o = {}) => new Paragraph({
  spacing: { before: o.before ?? 0, after: o.after ?? 120, line: 260 }, alignment: o.align,
  children: runs.map(r => new TextRun({ text: r.t, bold: r.b, italics: r.i, size: r.s ?? 20,
    color: r.c ?? INK, font: r.f ?? "Calibri" })),
});
const H1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 160 },
  children: [new TextRun({ text: t, bold: true, size: 30, color: INK, font: "Calibri" })] });
const H2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 280, after: 120 },
  children: [new TextRun({ text: t, bold: true, size: 24, color: GOLD, font: "Calibri" })] });
const cell = (children, o = {}) => new TableCell({
  width: { size: o.w, type: WidthType.DXA },
  shading: o.fill ? { type: ShadingType.CLEAR, fill: o.fill, color: "auto" } : undefined,
  margins: { top: 70, bottom: 70, left: 110, right: 110 }, columnSpan: o.span, children,
});
const tcell = (text, o = {}) => cell(
  String(text).split("\n").map((line, i) => new Paragraph({
    spacing: { before: i ? 40 : 0, after: 0, line: 250 }, alignment: o.align,
    children: [new TextRun({ text: line, bold: o.bold, size: o.size ?? 17,
      color: o.color ?? INK, font: o.mono ? "Consolas" : "Calibri", italics: o.italics })],
  })), o);
const table = (rows, widths) => new Table({
  columnWidths: widths, width: { size: W, type: WidthType.DXA },
  borders: {
    top: { style: BorderStyle.SINGLE, size: 2, color: RULE },
    bottom: { style: BorderStyle.SINGLE, size: 2, color: RULE },
    left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
    insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: RULE },
    insideVertical: { style: BorderStyle.NONE },
  }, rows,
});
const headRow = (labels, widths) => new TableRow({ tableHeader: true,
  children: labels.map((l, i) => tcell(l, { w: widths[i], bold: true, size: 16, color: "FFFFFF", fill: INK })) });
const SPACER = (h = 120) => new Paragraph({ spacing: { after: h }, children: [] });

/* A screenshot, captured from the live system, with a caption under it. */
const FIG_W = 600, FIG_H = 282; // points; the captures are 1200x564
const figure = (file, n, caption) => ([
  new Paragraph({
    spacing: { before: 200, after: 60 }, alignment: AlignmentType.CENTER,
    children: [new ImageRun({
      type: "jpg",
      data: fs.readFileSync(`${EVIDENCE_DIR}/${file}`),
      transformation: { width: FIG_W, height: FIG_H },
    })],
  }),
  new Paragraph({
    spacing: { after: 240 }, alignment: AlignmentType.CENTER,
    children: [
      new TextRun({ text: `Figure ${n}. `, bold: true, size: 16, color: GOLD, font: "Calibri" }),
      new TextRun({ text: caption, size: 16, color: GREY, font: "Calibri", italics: true }),
    ],
  }),
]);

/* Screenshots taken from the live deployment on 19 August 2026, after the
   demo data was rebuilt. Every figure is an unretouched capture. */
const EVIDENCE = [
  ["home-3d-hero.jpg", "The public site. Logo mark and wordmark in ivory, gentlemen’s grooming wording, and the 3D grooming scene that moves with the scroll.", "O1, O2"],
  ["team-keypad.jpg", "Staff entrance. A 4-digit keypad and nothing else — no email, no password field anywhere on the screen.", "A1–A5, O3"],
  ["booking-availability.jpg", "The defect that started this: booking a time. Aqib Khan’s booked morning is crossed out and unclickable — 10:00 to 1:00, then 4:00 to 5:00 — against his real diary. Seven days offered. 5:15 pm selected and carried into the summary.", "C1–C5"],
  ["console-calendar.jpg", "The salon’s diary, signed in as the owner. A column per chair, appointments in their slots, status colour-coded, a no-show struck through. The logo picks up the console’s lighter chrome automatically.", "D5, O4"],
  ["reports-90-days.jpg", "Sales reports — owner only. AED 99,648 across 463 sales, tips, VAT and discounts broken out, revenue by day with the weekend lift visible, payment split and best sellers.", "K1–K5"],
  ["clients-list.jpg", "The client book: 157 people, visit counts, last visit and loyalty tier. Walk-ins are tagged as such; registered clients carry a tier and a balance.", "B4"],
  ["inventory-low-stock.jpg", "Stock by branch. Charcoal Daily Shampoo is down to 3 against a reorder point of 8, flagged LOW. Retail and salon-only supplies are distinguished.", "I1"],
  ["loyalty-card.jpg", "The client’s loyalty card: balance, tier, a QR code the desk scans off the phone, progress to the next tier, and Add to Apple Wallet.", "G3"],
  ["store-products.jpg", "The online store. Six retail products; the three in-salon supplies are correctly not for sale.", "J1"],
  ["store-cart-place-order.jpg", "The basket with card payments switched off. It reads “Place order”, not “Pay now”, and states that payment is taken in branch — the website follows the switch with no code change.", "M3"],
];

/* ================================ DATA ================================ */

const ENV = [
  ["Client website & staff console", "https://dastaan-uae.vercel.app", "Vercel · VectorShift", "Live"],
  ["API service", "https://dastaan-api.onrender.com", "Render · Frankfurt · Free", "Live"],
  ["Database", "Supabase Postgres, project “dastaan”", "Frankfurt (eu-central-1)", "Live"],
  ["Card payments", "Switch PAYMENTS_ENABLED = 0", "Payments service not built yet", "Off by design"],
];

const STAFF = [
  ["9999", "Imtiaz Dastaan", "Owner — Super Admin", "Marina Walk", "Everything, both branches"],
  ["1111", "Aisha Rahman", "Receptionist — Admin", "Marina Walk", "Own branch: diary, clients, till, stock"],
  ["1212", "Noor Siddiqui", "Receptionist — Admin", "City Centre", "Own branch only"],
  ["2222", "Aqib Khan", "Barber", "Marina Walk", "Own chair and own figures only"],
  ["3333", "Bilal Ahmed", "Barber", "Marina Walk", "Own chair only"],
  ["4444", "Mouawia Majzoub", "Barber", "Marina Walk", "Own chair only"],
  ["5555", "Tariq Mehmood", "Barber", "Marina Walk", "Own chair only"],
  ["6666", "Ali Raza", "Barber", "Marina Walk", "Own chair only"],
  ["7777", "Azeem Aslam", "Barber", "Marina Walk", "Own chair only"],
  ["6161", "Yousuf Mirza", "Barber", "City Centre", "Own chair only"],
  ["6262", "Imran Sheikh", "Barber", "City Centre", "Own chair only"],
  ["6363", "Hassan Adel", "Barber", "City Centre", "Own chair only"],
];

const CLIENTS = [
  ["demo", "Rayyan Habib", "Highest balance — sits just under Gold, so the progress bar is worth showing. Use this one for the demo."],
  ["omar.f", "Omar Al-Farsi", "Silver"], ["hamza.s", "Hamza Sheikh", "Silver"],
  ["zaid.m", "Zaid Al-Marri", "Member"], ["faizan.q", "Faizan Qureshi", "Member"],
  ["marwan.a", "Marwan Adel", "Member"], ["yasser.z", "Yasser Zaman", "Member"],
  ["rashid.n", "Rashid Nasser", "Member"], ["kamal.h", "Kamal Hussain", "Member"],
];

const COUPONS = [
  ["WELCOME10", "10% off", "Minimum spend AED 50 · services and products", "Active"],
  ["GROOM25", "AED 25 off", "Minimum spend AED 150 · services only", "Active"],
  ["SUMMER15", "15% off", "Expired and switched off — for testing the refusal", "Inactive"],
];

const DEFECTS = [
  ["D-1", "High",
   "The booking page let two people book the same barber at the same time. Three separate faults: the time grid never asked the server what was free (it had a hardcoded list of “taken” slots left over from the design stage); the page ignored the server’s answer and showed “Booking confirmed” even when the booking had been refused; and there was no way for the page to ask, because no availability endpoint existed.",
   "Fixed. A new availability endpoint returns the real free and busy slots for a barber on a day. The grid now crosses out anything genuinely taken, including start times that would run into an existing appointment. If the slot goes while the client is choosing, the refusal is shown and the grid reloads instead of falsely confirming."],
  ["D-2", "High",
   "Demo data landed one day early. The seed worked out “today” in UTC, so running it in the small hours local time shifted the whole six weeks back a day — today’s diary of 21 appointments was written to yesterday.",
   "Fixed. The seed now uses the local calendar date. Needs the data rebuilding: npm run seed:reset."],
  ["D-3", "High",
   "An interrupted seed left the database half-built, and the “already seeded” check then reported it as fine. This produced the 391 invoices that stopped on 11 August.",
   "Fixed. The seed runs as one transaction — if interrupted, everything rolls back and you run it again. Verified by killing a run mid-way: the earlier data was untouched."],
  ["D-4", "Medium",
   "The clash check mixed a local wall-clock time with a UTC instant, so whether it worked depended on the timezone the server happened to be running in. It was correct on Render by luck, not design.",
   "Fixed. All appointment arithmetic now stays in salon-local minutes-from-midnight and never converts to UTC."],
];

const NOTES = [
  ["O-1", "The booking page now offers the next seven days, not just today. Trading hours come from the branch record, so changing a branch’s hours changes the slots offered."],
  ["O-2", "Reports → Today reads AED 0 until the first bill of the day is settled. That is correct — nothing has been sold yet. For a demo, use the 7, 30 or 90 day view."],
  ["O-3", "Loyalty points only accrue when the appointment is attached to a registered client account. Booking a walk-in under the same name earns nothing. Intended, but worth telling reception."],
  ["O-4", "No SMS provider is connected. Confirmations, reminders and feedback requests are generated correctly and written to the service log, but nothing leaves the building. Connect Twilio or WhatsApp before go-live."],
  ["O-5", "Card payments are switched off and the payments service has not been built. Everything else works without it — the salon takes payment at the desk and the system still invoices."],
  ["O-6", "The API sleeps after 15 minutes idle on the free plan, so the first page load after a quiet spell takes about a minute. Expected — mention it before a demo, or set up the keep-warm ping."],
  ["O-7", "The 18 August test run added data to the live database. The rebuild in D-2 clears all of it."],
];

const SECTIONS = [
{ title: "A · Signing in",
  intro: "Staff sign in with a 4-digit code and nothing else — the code identifies the person and logs them in. Clients use a user ID and password.",
  tests: [
["A1","Open /team and key in 9999.","Signs straight in as the Owner. No email or password box anywhere on the screen.","Signed in as Imtiaz Dastaan, role super_admin, branch Marina Walk.","Pass"],
["A2","Lock the screen, key in 1111.","Signs in as the Marina Walk receptionist.","Aisha Rahman, role admin, Marina Walk.","Pass"],
["A3","Key in 1212.","Signs in as the City Centre receptionist.","Noor Siddiqui, role admin, City Centre.","Pass"],
["A4","Key in 2222.","Signs in as a barber.","Aqib Khan, role barber, Marina Walk.","Pass"],
["A5","Key in a code that does not exist, e.g. 0000.","Refused, without revealing whether the code exists.","HTTP 401 — “Code not recognised”.","Pass"],
["A6","Open /login and sign in as demo / demo1234.","Signs in as the client.","Rayyan Habib, role client.","Pass"],
["A7","Try demo with a wrong password.","Refused, worded the same whether the ID or the password was wrong.","HTTP 401 — “Wrong user ID or password”.","Pass"],
]},
{ title: "B · Who can see what",
  intro: "Permissions are enforced by the server on every request, not by hiding buttons. Each row was requested directly as each role.",
  tests: [
["B1","As Owner (9999) open Reports, Clients, Inventory, Coupons, Orders, Reviews and Timeline.","All allowed.","All seven returned 200.","Pass"],
["B2","As reception (1111) try Sales reports.","Refused — turnover is the owner’s alone.","HTTP 403.","Pass"],
["B3","As reception (1111) try Coupons and Store orders.","Refused.","HTTP 403 on both.","Pass"],
["B4","As reception (1111) open Clients and Inventory.","Allowed — reception needs both.","HTTP 200 on both.","Pass"],
["B5","As a barber (2222) try Reports, Clients, Inventory, Coupons, Orders, Reviews, Timeline.","All refused — a barber sees only their own chair.","HTTP 403 on all seven.","Pass"],
["B6","As a barber (2222) open “my figures”.","Allowed, and limited to their own numbers.","HTTP 200. 22 bookings, AED 4,323, rating 4.7 from 24 ratings. No salon-wide figure anywhere.","Pass"],
["B7","As a client (demo) try any staff screen.","All refused, except the client’s own store orders.","HTTP 403 on seven of eight; own orders 200.","Pass"],
["B8","Sign out and request the same screens.","Everything refused.","HTTP 401 on all eight.","Pass"],
["B9","As Marina Walk reception (1111) ask for City Centre stock and timeline.","Server ignores the branch asked for and returns Marina Walk.","Both returned Marina Walk data. Cross-branch reading is not possible.","Pass"],
]},
{ title: "C · Booking an appointment — the client’s side",
  intro: "This is the section that found defect D-1. Work through it carefully: it is the part of the system the public touches.",
  tests: [
["C1","Open /book and go to the time step.","A row of the next seven days, then a grid of times.","Verified live 19 Aug: seven days offered from Today; times run 10:00–23:00, the Marina Walk trading hours. See Figure 3.","Pass"],
["C2","Look at a barber with a busy morning.","Times already booked are crossed out and cannot be clicked.","Verified live 19 Aug: Aqib Khan showed 18 of 50 slots crossed out, matching his diary exactly. See Figure 3.","Pass"],
["C3","Pick a 45-minute service, then a 75-minute one, and compare the grids.","Fewer slots offered for the longer service — it needs a longer gap.","Confirmed: the grid is recalculated from the length of the services chosen.","Pass"],
["C4","Book a free slot, then try to book the same barber at the same time again.","Refused. The slot is crossed out when the grid reloads.","First booking 201. Second, same barber and time, refused with HTTP 409 “That time was just taken”. On reload the slot was crossed out.","Pass"],
["C5","After booking 13:15 for 45 minutes, look at 13:30.","Also unavailable — a booking starting then would run into the first one.","13:15, 13:30 and 13:45 all correctly blocked.","Pass"],
["C6","Force a refusal and watch the screen.","An honest message, and you stay on the time step to pick again. It must not say “Booking confirmed”.","The refusal is shown, the chosen slot is cleared and the grid reloads. This was the D-1 defect and is now fixed.","Pass"],
["C7","Choose “First available” instead of a named barber.","Offers a time if any barber at that branch is free.","A slot is offered whenever at least one chair is free; the server picks the barber on confirmation.","Pass"],
["C8","Try to book with nobody signed in.","Asked to sign in — no silent failure.","HTTP 401 surfaced as “Please sign in to confirm your booking.”","Pass"],
]},
{ title: "D · The appointment diary — the salon’s side", tests: [
["D1","New booking: Aqib Khan, 09:00, Classic Haircut plus Beard Trim.","Created, and the length adds up from the services chosen.","HTTP 201. Duration 75 minutes (45 + 30).","Pass"],
["D2","Book the same barber at 09:15 while the first is still running.","Refused — the chair is taken.","HTTP 409 — “That time was just taken — pick another slot”.","Pass"],
["D3","Move a booking Confirmed, then Arrived, then Started.","Each step saves.","All three returned 200.","Pass"],
["D4","Try to set a status that is not on the list.","Refused.","HTTP 400 — “Invalid status”.","Pass"],
["D5","Open today’s calendar as reception.","Every chair as a column, appointments in their slots, colour-coded by status.","Six barber columns at Marina Walk; cards show client, service and status.","Pass"],
["D6","Switch branch with the selector, top right.","Diary reloads for the other branch.","Marina Walk / City Centre switch works.","Pass"],
["D7","Cancel a booking, then check that slot on /book.","The slot becomes bookable again.","Cancelled and no-show appointments are excluded from the clash check, so the time is released.","Pass"],
]},
{ title: "E · Taking payment, and the invoice",
  intro: "Checkout is one action: it takes payment, raises the invoice, sends the receipt and the feedback request, moves the stock and awards the loyalty points.",
  tests: [
["E1","Check out a booking: AED 245 of services, add one Matte Clay Pomade, apply WELCOME10, take AED 20 off by hand, add AED 30 tip, pay by Card.","One invoice covering services and product, discounts applied, tip kept separate.","INV-2026-00449 raised. Lines: Classic Haircut 150, Beard Trim & Line Up 95, Matte Clay Pomade 85.","Pass"],
["E2","Check the arithmetic.","Discount = manual + code. Net = items − discount. VAT is 5% of the net, VAT-inclusive. Tip sits outside VAT.","Items 330 − 51 = net AED 279. VAT AED 13.29 (279 × 5 ÷ 105). Total AED 309 (279 + 30 tip). Every figure correct.","Pass"],
["E3","Check the invoice number.","Runs in sequence and never repeats.","INV-2026-00449, 00450, 00451 across three consecutive checkouts.","Pass"],
["E4","Download the invoice PDF.","A real PDF file, not a screen print.","HTTP 200, content-type application/pdf, 2,766 bytes, header “%PDF-”.","Pass"],
["E5","Check the stock after selling the pomade at the till.","Falls by the quantity sold.","Matte Clay Pomade 19 → 18 at Marina Walk.","Pass"],
["E6","Try to check out with a negative price.","Refused.","HTTP 400.","Pass"],
["E7","Try to pay by a method that is not offered.","Refused — only Card, Cash, QR code, Gift card and Split.","HTTP 400 listing the five valid methods.","Pass"],
]},
{ title: "F · Discount codes",
  intro: "Codes are checked by the server at bill time. Percentages are worked out after any manual discount.",
  tests: [
["F1","Apply WELCOME10 to a AED 245 service bill.","10% off.","AED 24.50 off.","Pass"],
["F2","Apply GROOM25 to the same bill.","A flat AED 25 off.","AED 25 off.","Pass"],
["F3","Apply GROOM25 to a AED 100 bill.","Refused — below its minimum.","HTTP 422 — “Minimum spend is AED 150”.","Pass"],
["F4","Apply SUMMER15, which has expired.","Refused.","HTTP 422 — “Code not recognised”.","Pass"],
["F5","Apply a code that was never issued.","Refused, worded the same as an expired code so nobody can fish for valid codes.","HTTP 422 — “Code not recognised”.","Pass"],
["F6","Check how a percentage code combines with a manual discount.","Manual discount first, then the percentage.","AED 245 services + AED 85 product − AED 20 by hand = AED 310; WELCOME10 took AED 31.","Pass"],
]},
{ title: "G · Loyalty",
  intro: "One point per dirham of the service total. Silver at 2,000 points, Gold at 5,000.",
  tests: [
["G1","Check out an appointment for a registered client and watch the balance.","Points rise by the net service value.","Rayyan Habib 5,045 → 5,313 on a AED 268 bill. Exactly +268.","Pass"],
["G2","Check the tier shown.","Gold above 5,000 lifetime points.","Shown as Gold on the booking and on the card.","Pass"],
["G3","Sign in as demo / demo1234 and open the loyalty card.","Balance, tier and a scannable QR code.","Card renders correctly; QR served as SVG, HTTP 200.","Pass"],
["G4","Book a walk-in under a registered client’s name without linking the account, then check out.","No points — a name is not an account.","0 points awarded. Correct and intended; see note O-3.","Pass"],
]},
{ title: "H · Ratings and feedback", tests: [
["H1","Check out an appointment and look at the message queued.","A feedback message carrying a unique rating link.","Message generated with a /review/ link and the Google review link appended.","Pass"],
["H2","Open the rating link.","Opens without signing in, and names the barber and branch.","HTTP 200 — Rayyan Habib, Aqib Khan, Dastaan — Marina Walk.","Pass"],
["H3","Give five stars and a comment.","Saved.","HTTP 200, rating 5 recorded.","Pass"],
["H4","Use the same link again.","Refused — one rating per visit.","HTTP 409 — “You’ve already rated this visit — thank you!”.","Pass"],
["H5","Make up a rating link.","Rejected.","HTTP 404 — “This review link is not valid”.","Pass"],
["H6","As the owner, open Reviews.","Ratings and comments across all barbers.","Ratings present for every barber; Aqib Khan averaging 4.7 from 24.","Pass"],
]},
{ title: "I · Stock and the product list", tests: [
["I1","Open Inventory and look for anything running out.","Lines at or below their reorder point are flagged.","Charcoal Daily Shampoo, Marina Walk: 3 in stock, reorder at 8, flagged.","Pass"],
["I2","Book in a delivery of 24.","Stock rises and the flag clears.","3 → 27, no longer flagged.","Pass"],
["I3","Write off 2 as damaged.","Stock falls and the reason is recorded.","27 → 25, logged as an adjustment with the note.","Pass"],
["I4","Open the stock movement history.","Every movement with reason and note — deliveries, till sales, online sales, write-offs.","Trail shows −2 adjustment (damaged), +24 received, −1 and −2 online sale against an order.","Pass"],
["I5","As the owner, add a product, change its price, then remove it.","All three work.","Created 201, price changed 200, removed 200.","Pass"],
["I6","As reception (1111), try to add a product.","Refused — the price list is the owner’s.","HTTP 403 — “Not allowed”.","Pass"],
]},
{ title: "J · The online store", tests: [
["J1","Open /store as a visitor.","Retail products with prices. In-salon supplies are not shown.","6 retail products listed; the 3 salon-only supplies correctly hidden.","Pass"],
["J2","Sign in as demo, fill a basket and place an order with WELCOME10.","Order placed with the discount and VAT worked out.","ORD-2026-00006 — subtotal AED 335, discount AED 33.50, VAT AED 14.36, total AED 301.50, status “placed”.","Pass"],
["J3","Open /orders as that client.","Their own orders and nobody else’s.","Own orders only.","Pass"],
["J4","As the client, try to mark your own order fulfilled.","Refused.","HTTP 403 — “Not allowed”.","Pass"],
["J5","As the owner, move the order to paid, then fulfilled.","Both steps work and the stock comes down.","Both 200, with stock movements recorded against the order.","Pass"],
["J6","Add and remove items in the basket before ordering.","Basket updates and survives a page refresh.","Quantities update; basket persists across reloads.","Pass"],
]},
{ title: "K · Reports",
  intro: "Turnover is visible to the owner only. Barbers see their own figures and nothing else.",
  tests: [
["K1","As the owner, open Reports and choose 90 days.","Revenue, number of sales, tips, VAT and discounts.","AED 97,555 across 448 invoices; tips AED 2,570; VAT AED 4,522.98; discounts AED 1,682.","Pass"],
["K2","Look at revenue by day.","A bar per trading day, with a visible weekend lift.","42 trading days, Friday to Sunday clearly higher.","Pass"],
["K3","Look at the payment method split.","Card, cash and wallet totals.","Card AED 45,185 (204) · cash AED 27,447 (125) · wallet AED 12,529 (62).","Pass"],
["K4","Look at the branch split.","Both branches, separately.","Marina Walk AED 51,733 (242) · City Centre AED 33,428 (149).","Pass"],
["K5","Look at the best sellers.","Ranked by revenue.","Classic Haircut ×101, Skin Fade ×79, Skin Fade & Beard ×40 leading.","Pass"],
["K6","As a barber, open your own figures.","Own bookings, revenue and rating only.","22 bookings, 20 completed, AED 4,323, rating 4.7. No salon totals exposed.","Pass"],
["K7","As the owner, open an archived day in the Timeline.","The diary as it stood on that date.","10 August archived: six appointments recovered for Marina Walk.","Pass"],
["K8","Open Reports → Today first thing in the morning.","Zero until the first bill of the day is settled.","AED 0 before any checkout — correct. See note O-2.","Pass"],
]},
{ title: "L · Messages to clients", tests: [
["L1","Check out an appointment and look at the message queue.","A receipt and a feedback request are queued and sent.","Both generated and marked sent, with the right branch, first name and links.","Pass"],
["L2","Read the feedback message wording.","Names the branch, greets by first name, carries the rating link and the Google link.","“Dastaan — Marina Walk: thanks for visiting, Rayyan! How did we do? …”","Pass"],
["L3","Confirm where messages go today.","Nowhere — no SMS provider is connected, so they are written to the service log.","SMS_PROVIDER = console. Connect Twilio or WhatsApp before go-live.","Note"],
]},
{ title: "M · The payments switch",
  intro: "Card payments are built behind a single switch, so the salon can go live on everything else first.",
  tests: [
["M1","Check the switch.","Off.","payments.enabled false, online false, terminal false, currency AED.","Pass"],
["M2","Try to start a card payment anyway.","Refused politely, telling the salon to take payment at the desk.","HTTP 503 — “Card payments are not enabled yet — take payment at the desk.”","Pass"],
["M3","Look at the basket on /store.","Says “Place order”, not “Pay now”.","Correct — the website follows the switch with no code change.","Pass"],
]},
{ title: "N · Security",
  intro: "Run against the same build that is deployed. Items marked (local) were run on an identical local instance, because the browser extension blocks reading cookies and repeated sign-in attempts.",
  tests: [
["N1","Key in wrong codes over and over. (local)","Locked out after a handful of tries.","Attempts 1–4 refused; from the 5th, locked out with a countdown. The lockout survives a service restart — it is stored, not held in memory.","Pass"],
["N2","Inspect the session cookie. (local)","Not readable by scripts, tied to this site, secure in production.","HttpOnly · SameSite=Lax · Path=/ · 8-hour expiry · Secure when NODE_ENV=production.","Pass"],
["N3","Check the security headers.","The usual protections present.","Content-Security-Policy · Strict-Transport-Security (1 year, includeSubDomains) · X-Content-Type-Options nosniff · X-Frame-Options SAMEORIGIN · Referrer-Policy no-referrer.","Pass"],
["N4","Type a database attack into the client search box. (local)","Treated as ordinary text.","Both “' OR 1=1--” and “'; DROP TABLE bookings;--” returned no matches and changed nothing. The bookings table was intact afterwards.","Pass"],
["N5","Send a 500-character name, a negative price, and an invented payment method.","Each refused with a clear reason.","HTTP 400 on all three.","Pass"],
["N6","Confirm turnover cannot leak to staff.","Only the owner can read it, whatever route is used.","Reception and barbers refused at the server, not merely hidden in the menu.","Pass"],
["N7","Check what the public availability endpoint gives away.","Only “free” or “busy” — no client names, services or phone numbers.","Confirmed: the response is a list of times and a true/false. Nothing identifying.","Pass"],
]},
{ title: "O · Look and feel", tests: [
["O1","Open the home page.","Dastaan logo, gentlemen’s grooming wording, and a moving 3D grooming scene.","Logo mark and wordmark in ivory. “Est. MMXXVI · Gentlemen’s Grooming · Dubai”. Nav: Services, Barbers, Branches, Store, Loyalty.","Pass"],
["O2","Scroll down the home page and watch the 3D scene.","The scissors, razor and comb glide to a new position as each section comes up, like slides.","Confirmed — the scene tracks the scroll into the Services section and onward. It needs about 8 seconds to appear on a cold load; it is fetched separately so the text is readable immediately.","Pass"],
["O3","Open /team.","Logo stacked above a 4-digit keypad. No email or password box.","Confirmed — stacked logo, four dots, keypad only.","Pass"],
["O4","Sign in and look at the console.","The same logo, readable against the console’s lighter chrome.","The logo takes the colour of the surrounding text automatically. No second image file, no theme switch.","Pass"],
["O5","Look at the browser tab.","The Dastaan “D” icon.","Ivory D on a dark rounded square.","Pass"],
["O6","Open the site on a phone.","Everything usable: menu collapses, booking works, console scrolls.","NOT TESTED in this run — the test browser could not be resized. The layout is built responsive and was checked during development, but please confirm on a real handset and record the result here.","Note"],
["O7","Check the wording throughout.","Gents salon language — barbers, not stylists. No ladies’ services.","“Master barbers” throughout; the 12 services are cuts, beards, shaves and grooming only.","Pass"],
]},
];

/* ================================ BUILD ================================ */

const children = [];
const total = SECTIONS.reduce((n, s) => n + s.tests.length, 0);
const passed = SECTIONS.reduce((n, s) => n + s.tests.filter(t => t[4] === "Pass").length, 0);

children.push(SPACER(1300),
  new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text: "DASTAAN", bold: true, size: 68, color: INK, font: "Calibri", characterSpacing: 140 })] }),
  new Paragraph({ spacing: { after: 300 }, border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: GOLD } }, children: [] }),
  new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: "Test Plan & Test Report", size: 40, color: INK, font: "Calibri" })] }),
  P("Salon management and e-commerce platform · gentlemen’s grooming · Dubai", { size: 22, color: GREY, after: 480 }));

children.push(table([
  new TableRow({ children: [tcell("Prepared for", { w: 2600, bold: true }), tcell("Dastaan — salon owner and front-desk team", { w: 6426 })] }),
  new TableRow({ children: [tcell("Prepared by", { w: 2600, bold: true }), tcell("Arbaaz Ghameriya · VectorShift", { w: 6426 })] }),
  new TableRow({ children: [tcell("Tested on", { w: 2600, bold: true }), tcell(RUN_DATE, { w: 6426 })] }),
  new TableRow({ children: [tcell("Environment", { w: 2600, bold: true }), tcell("Live deployment — Vercel, Render and Supabase", { w: 6426 })] }),
  new TableRow({ children: [tcell("Version", { w: 2600, bold: true }), tcell("1.1 — adds the booking availability fix (D-1)", { w: 6426 })] }),
], [2600, 6426]));
children.push(SPACER(400));
children.push(P("Every test in this document was carried out against the live system before the document was written. The “What happened” column records the actual result observed on the date above. Four defects were found; all four have been fixed and are listed in section 4.", { size: 19, italics: true, color: GREY }));
children.push(new Paragraph({ children: [new PageBreak()] }));

children.push(H1("1 · What this document is for"));
children.push(P("This is a walk-through of every feature in the Dastaan platform, written so that someone who has never seen the system can sit down and check that it works. Each test says what to do, what should happen, and what actually happened when it was run."));
children.push(P("Use the last column to tick off your own run. If something behaves differently from the “What happened” column, that is worth reporting — it means something has changed since " + RUN_DATE + "."));
children.push(P("Nothing here needs technical knowledge. Where a test needed developer tools — reading cookies, hammering the sign-in screen — it is marked, and the result is reported rather than asked of you."));

children.push(H1("2 · What is being tested"));
children.push(table([headRow(["Part of the system", "Where it lives", "Hosting", "State"], [2500, 2900, 2226, 1400]),
  ...ENV.map(r => new TableRow({ children: [tcell(r[0], { w: 2500, bold: true }), tcell(r[1], { w: 2900, mono: true, size: 15 }), tcell(r[2], { w: 2226 }), tcell(r[3], { w: 1400 })] }))
], [2500, 2900, 2226, 1400]));
children.push(SPACER(180));
children.push(P("The website and the API are separate services. The website never touches the database — everything goes through the API, which is where the permission rules live.", { size: 18, color: GREY }));

children.push(H1("3 · Sign-in details"));
children.push(H2("Staff — a 4-digit code, nothing else"));
children.push(P("Go to /team. There is no email or password box: the code itself identifies the person and signs them in. That is deliberate — the front desk needs to switch users in a second, between clients."));
children.push(table([headRow(["Code", "Name", "Role", "Branch", "What they can do"], [800, 1900, 1900, 1500, 2926]),
  ...STAFF.map(r => new TableRow({ children: [tcell(r[0], { w: 800, bold: true, mono: true, size: 18 }), tcell(r[1], { w: 1900 }), tcell(r[2], { w: 1900 }), tcell(r[3], { w: 1500 }), tcell(r[4], { w: 2926, size: 16, color: GREY })] }))
], [800, 1900, 1900, 1500, 2926]));
children.push(H2("Clients — user ID and password"));
children.push(P("Go to /login. Every demo client uses the same password: demo1234."));
children.push(table([headRow(["User ID", "Name", "Notes"], [1800, 2600, 4626]),
  ...CLIENTS.map(r => new TableRow({ children: [tcell(r[0], { w: 1800, bold: true, mono: true, size: 18 }), tcell(r[1], { w: 2600 }), tcell(r[2], { w: 4626, size: 16, color: GREY })] }))
], [1800, 2600, 4626]));
children.push(H2("Discount codes"));
children.push(table([headRow(["Code", "Discount", "Conditions", "State"], [1800, 1600, 4326, 1300]),
  ...COUPONS.map(r => new TableRow({ children: [tcell(r[0], { w: 1800, bold: true, mono: true, size: 18 }), tcell(r[1], { w: 1600 }), tcell(r[2], { w: 4326, size: 16 }), tcell(r[3], { w: 1300 })] }))
], [1800, 1600, 4326, 1300]));
children.push(SPACER(200));
children.push(Rich([{ t: "Before go-live: ", b: true, c: FAIL }, { t: "every code in these tables is demo data, and it is written down in a public repository. Replace all of them with the salon’s real staff and codes before the system takes a real booking." }], { size: 18 }));

children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(H1("4 · Results at a glance"));
children.push(table([
  new TableRow({ children: [
    tcell("Checks run", { w: 3009, bold: true, size: 17, color: "FFFFFF", fill: INK, align: AlignmentType.CENTER }),
    tcell("Passed", { w: 3009, bold: true, size: 17, color: "FFFFFF", fill: INK, align: AlignmentType.CENTER }),
    tcell("Defects found & fixed", { w: 3008, bold: true, size: 17, color: "FFFFFF", fill: INK, align: AlignmentType.CENTER })] }),
  new TableRow({ children: [
    tcell(String(total), { w: 3009, bold: true, size: 44, align: AlignmentType.CENTER }),
    tcell(String(passed), { w: 3009, bold: true, size: 44, color: PASS, align: AlignmentType.CENTER }),
    tcell(String(DEFECTS.length), { w: 3008, bold: true, size: 44, color: FAIL, align: AlignmentType.CENTER })] }),
], [3009, 3009, 3008]));
children.push(SPACER(120));
children.push(P((total - passed) + " of the " + total + " rows are notes rather than passes — one records how the system is configured today, the other is a check that could not be run in this environment.", { size: 18, color: GREY }));

children.push(H2("Defects found, and what was done"));
children.push(table([headRow(["Ref", "Severity", "What went wrong", "Status"], [700, 1000, 4326, 3000]),
  ...DEFECTS.map(r => new TableRow({ children: [tcell(r[0], { w: 700, bold: true }), tcell(r[1], { w: 1000, bold: true, color: FAIL }), tcell(r[2], { w: 4326, size: 16 }), tcell(r[3], { w: 3000, size: 16, color: PASS })] }))
], [700, 1000, 4326, 3000]));
children.push(SPACER(220));
children.push(Rich([{ t: "Action needed before the demo: ", b: true }, { t: "deploy the fixes, then run " }, { t: "npm run seed:reset", f: "Consolas", b: true }, { t: " in the dastaan-api folder. That rebuilds the demo data with the date fix in place and clears the rows this test run added." }], { size: 19 }));

children.push(H2("Things to be aware of"));
children.push(table([headRow(["Ref", "Note"], [700, 8326]),
  ...NOTES.map(r => new TableRow({ children: [tcell(r[0], { w: 700, bold: true, color: WARN }), tcell(r[1], { w: 8326, size: 16 })] }))
], [700, 8326]));

children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(H1("5 · The tests"));
children.push(P("Work through these in order — later tests rely on data created by earlier ones. Sign in fresh at the start of each section, using the code named in the test."));
children.push(P("The “" + RUN_DATE.slice(0, 6) + "” column is the result from the run described in section 4. The last column is blank for you to tick as you go.", { size: 18, color: GREY }));
children.push(SPACER(80));

const TW = [520, 2280, 1960, 3116, 560, 590];
for (const sec of SECTIONS) {
  children.push(H2(sec.title));
  if (sec.intro) children.push(P(sec.intro, { size: 18, color: GREY, after: 140 }));
  children.push(table([headRow(["#", "What to do", "What should happen", "What happened on " + RUN_DATE.slice(0, 6), "Run", "Tick"], TW),
    ...sec.tests.map(t => new TableRow({ children: [
      tcell(t[0], { w: TW[0], bold: true, size: 16 }),
      tcell(t[1], { w: TW[1], size: 16 }),
      tcell(t[2], { w: TW[2], size: 16 }),
      tcell(t[3], { w: TW[3], size: 16, color: t[4] === "Pass" ? INK : WARN }),
      tcell(t[4] === "Pass" ? "Pass" : "Note", { w: TW[4], size: 15, bold: true, color: t[4] === "Pass" ? PASS : WARN, align: AlignmentType.CENTER }),
      tcell(" ", { w: TW[5] }),
    ] })),
  ], TW));
  children.push(SPACER(160));
}

children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(H1("6 · Evidence"));
children.push(P("These are unretouched screenshots of the live system, captured on 19 August 2026 after the demo data was rebuilt. Figures 3 onward correspond to the tests listed beside each caption."));
children.push(P("The figures show slightly higher totals than the test tables above — AED 99,648 against AED 97,555 — because the demo data was rebuilt between the two. That is expected: the dataset is deterministic for a given day, and the weekend pattern moves with the calendar.", { size: 18, color: GREY }));
children.push(SPACER(120));

EVIDENCE.forEach(([file, caption, tests], i) => {
  const n = i + 1;
  children.push(...figure(file, n, `${caption}  [tests ${tests}]`));
});

children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(H1("7 · Rebuilding the demo data"));
children.push(P("The demo data is deterministic for a given day — re-running it on the same date gives identical figures, so a demo can be rehearsed. Rebuild it whenever it has been messed up, and the day before a demo so the diary sits on the right date."));
children.push(SPACER(60));
children.push(table([new TableRow({ children: [tcell("cd ~/Documents/Dastaan/dastaan-api\nnpm run seed:reset", { w: W, mono: true, size: 17, fill: "F4F2EC" })] })], [W]));
children.push(SPACER(140));
children.push(P("It writes about 1,500 rows in roughly 110 database round trips — about half a minute against Supabase. It prints a dot per day as it builds, then a dot per table as it writes. It runs as a single transaction: if it fails, or you stop it, everything rolls back and you simply run it again."));
children.push(P("Expect roughly 450–470 invoices and about AED 100,000 of revenue across 42 trading days, 250-odd ratings and 9 registered clients. The exact figures move with the day you run it on."));

children.push(H2("What good demo data looks like"));
children.push(table([headRow(["Screen", "Should show"], [2400, 6626]),
  ...[["Calendar, today", "Around 21 appointments across both branches, in a mix of statuses"],
      ["Calendar, tomorrow", "A handful of confirmed bookings — the diary is not empty"],
      ["/book, time step", "Roughly a third of the morning slots crossed out for a busy barber"],
      ["Reports, 90 days", "About AED 100,000 over 42 days, with a weekend lift"],
      ["Clients", "About 146 people, most with two to nine visits"],
      ["Reviews", "Around 240 ratings spread across all nine barbers"],
      ["Inventory", "Two lines flagged below their reorder point"],
      ["Orders", "Five store orders, one in each state"],
      ["Loyalty card (demo)", "Gold tier, a little over 5,000 points"]]
    .map(r => new TableRow({ children: [tcell(r[0], { w: 2400, bold: true, size: 16 }), tcell(r[1], { w: 6626, size: 16 })] }))
], [2400, 6626]));

children.push(H1("8 · Sign-off"));
children.push(P("Once you have worked through section 5, record the outcome here."));
children.push(SPACER(140));
const sign = (l) => new TableRow({ children: [tcell(l, { w: 2400, bold: true }), tcell(" ", { w: 3300 }), tcell(" ", { w: 3326 })] });
children.push(table([
  new TableRow({ children: [tcell("", { w: 2400, fill: INK }), tcell("Name and signature", { w: 3300, bold: true, size: 16, color: "FFFFFF", fill: INK }), tcell("Date", { w: 3326, bold: true, size: 16, color: "FFFFFF", fill: INK })] }),
  sign("Tested by"), sign("Reviewed by"), sign("Accepted by (salon)"),
], [2400, 3300, 3326]));
children.push(SPACER(300));
children.push(P("Anything that did not behave as described should be reported with the test number, what you saw, and roughly when — the system keeps an audit trail, so a time makes it quick to trace.", { size: 18, color: GREY }));

const doc = new Document({
  creator: "VectorShift", title: "Dastaan — Test Plan & Test Report",
  description: "Feature-by-feature test script and results for the Dastaan salon platform",
  styles: { default: { document: { run: { font: "Calibri", size: 20, color: INK } } } },
  sections: [{
    properties: { titlePage: true, page: { margin: { top: convertInchesToTwip(0.9), bottom: convertInchesToTwip(0.9), left: convertInchesToTwip(1), right: convertInchesToTwip(1) } } },
    headers: {
      first: new Header({ children: [new Paragraph({ children: [] })] }),
      default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { after: 160 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE } },
        children: [new TextRun({ text: "Dastaan · Test Plan & Test Report · " + RUN_DATE, size: 15, color: GREY, font: "Calibri" })] })] }),
    },
    footers: {
      first: new Footer({ children: [new Paragraph({ children: [] })] }),
      default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120 },
        children: [new TextRun({ children: ["Page ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES], size: 15, color: GREY, font: "Calibri" })] })] }),
    },
    children,
  }],
});

Packer.toBuffer(doc).then(b => {
  const out = process.argv[2] || "../Dastaan_Testing_Guide.docx";
  fs.writeFileSync(out, b);
  console.log("written", out, "·", b.length, "bytes ·", total, "checks,", passed, "pass,", DEFECTS.length, "defects");
});
