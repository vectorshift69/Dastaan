/* ------------------------------------------------------------------ */
/* Dastaan payments service.                                           */
/*                                                                     */
/* The only process that holds Stripe credentials. The main API talks   */
/* to it over a shared service token and never sees a key; the browser  */
/* never talks to it at all.                                            */
/*                                                                     */
/* Two rules run through everything here:                               */
/*                                                                     */
/*  1. The amount is decided here, from the database — never taken from */
/*     the request. Otherwise anyone could pay AED 1 for a AED 300 bill.*/
/*                                                                     */
/*  2. Webhooks are recorded before they are acted on. Stripe delivers  */
/*     at least once and retries for days, so "did we already handle    */
/*     this event?" has to be answered from storage, not from memory.   */
/* ------------------------------------------------------------------ */

import "./load-env.js"; // MUST be first
import Fastify from "fastify";
import { z } from "zod";
import type Stripe from "stripe";
import { config, stripeAccount, toMinor, toMajor, paymentChoices } from "./config.js";
import { db, migrate, uid, now } from "./db.js";

type PaymentRow = { id: string; intent_id: string; amount: number; status: string; refunded_amount: number };

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? "info" },
  trustProxy: process.env.TRUST_PROXY === "1",
});

await migrate();

/* ------------------------------------------------------------------ */
/* Only the main API may call us.                                      */
/* ------------------------------------------------------------------ */
app.addHook("onRequest", async (req, reply) => {
  if (req.url === "/health" || req.url.startsWith("/webhook")) return; // Stripe has its own proof
  const token = req.headers["x-service-token"];
  if (typeof token !== "string" || token !== config.serviceToken) {
    reply.code(401).send({ error: "Not authorised" });
  }
});

app.get("/health", async () => ({ ok: true, service: "dastaan-payments" }));

/* ------------------------------------------------------------------ */
/* Create a payment intent.                                            */
/* ------------------------------------------------------------------ */
const intentSchema = z.object({
  orderId: z.string().min(1).optional(),
  bookingId: z.string().min(1).optional(),
  invoiceId: z.string().min(1).optional(),
  clientId: z.string().min(1).optional(),
}).refine(
  (v) => [v.orderId, v.bookingId, v.invoiceId].filter(Boolean).length === 1,
  "Provide exactly one of orderId, bookingId or invoiceId"
);

app.post("/intent", async (req, reply) => {
  const parsed = intentSchema.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: "Invalid request" });
  const { orderId, bookingId, invoiceId, clientId } = parsed.data;

  /* ---- what is actually owed, worked out from our own records ----
     Nothing here is taken from the request but the id. */
  let amount: number;
  let kind: "order" | "booking" | "invoice";
  let description: string;

  if (orderId) {
    const order = await db.prepare(
      "SELECT id, total, status FROM orders WHERE id = ?"
    ).get(orderId) as { id: string; total: number; status: string } | undefined;
    if (!order) return reply.code(404).send({ error: "Order not found" });
    if (order.status !== "placed")
      return reply.code(409).send({ error: `That order is already ${order.status}` });
    amount = Number(order.total);
    kind = "order";
    description = "Dastaan store order";

  } else if (bookingId) {
    if (!config.booking.payNowEnabled)
      return reply.code(503).send({ error: "Paying at the time of booking is switched off" });

    const b = await db.prepare(
      "SELECT id, minutes, service_ids, payment_status, status FROM bookings WHERE id = ?"
    ).get(bookingId) as
      | { id: string; minutes: number; service_ids: string; payment_status: string; status: string }
      | undefined;
    if (!b) return reply.code(404).send({ error: "Booking not found" });
    if (b.payment_status === "prepaid")
      return reply.code(409).send({ error: "That appointment is already paid" });
    if (b.status === "Cancelled")
      return reply.code(409).send({ error: "That booking is cancelled" });

    /* price the services here — never trust a total sent in */
    let bill = 0;
    for (const sid of JSON.parse(b.service_ids) as string[]) {
      const svc = await db.prepare("SELECT price FROM services WHERE id = ?").get(sid) as { price: number } | undefined;
      bill += Number(svc?.price ?? 0);
    }
    if (bill <= 0) return reply.code(409).send({ error: "Nothing to pay for that booking" });

    amount = bill;                 // the whole appointment, not a part of it
    kind = "booking";
    description = "Dastaan appointment";

  } else {
    /* settling a bill from the app after the visit */
    const inv = await db.prepare(
      "SELECT id, invoice_no, total, settled FROM invoices WHERE id = ?"
    ).get(invoiceId!) as { id: string; invoice_no: string; total: number; settled: number } | undefined;
    if (!inv) return reply.code(404).send({ error: "Bill not found" });
    if (inv.settled) return reply.code(409).send({ error: "That bill is already settled" });
    amount = Number(inv.total);
    kind = "invoice";
    description = `Dastaan ${inv.invoice_no}`;
  }

  if (amount <= 0) return reply.code(400).send({ error: "Nothing to pay" });

  /* ---- create it at Stripe ---- */
  const stripe = stripeAccount();
  const id = uid();
  let intent: Stripe.PaymentIntent;
  try {
    intent = await stripe.paymentIntents.create(
      {
        amount: toMinor(amount),
        currency: config.currency,
        description,
        automatic_payment_methods: { enabled: true },
        /* so the salon can trace a charge back to a booking or bill */
        metadata: {
          kind,
          orderId: orderId ?? "",
          bookingId: bookingId ?? "",
          invoiceId: invoiceId ?? "",
          paymentId: id,
        },
      },
      /* a double tap, or a retried request, returns the same intent rather
         than charging the client twice */
      { idempotencyKey: `${kind}:${orderId ?? bookingId ?? invoiceId}` }
    );
  } catch (err) {
    req.log.error({ err }, "stripe intent failed");
    return reply.code(502).send({ error: "Could not start the payment. Please try again." });
  }

  await db.prepare(
    `INSERT INTO payments (id, intent_id, kind, order_id, booking_id, invoice_id, client_id,
       amount, currency, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?, 'requires_payment', ?, ?)
     ON CONFLICT (intent_id) DO NOTHING`
  ).run(id, intent.id, kind, orderId ?? null, bookingId ?? null, invoiceId ?? null,
    clientId ?? null, amount, config.currency, now(), now());

  if (kind === "booking") {
    await db.prepare("UPDATE bookings SET payment_intent_id = ? WHERE id = ?").run(intent.id, bookingId);
  }

  return { amount, currency: config.currency, clientSecret: intent.client_secret };
});

/* ------------------------------------------------------------------ */
/* What payment choices should the booking page offer?                  */
/* ------------------------------------------------------------------ */
app.get("/choices", async () => paymentChoices());

/* ------------------------------------------------------------------ */
/* Refund — a prepaid appointment cancelled in time, or a returned bill.*/
/* ------------------------------------------------------------------ */
app.post("/refund", async (req, reply) => {
  const parsed = z.object({
    bookingId: z.string().min(1).optional(),
    invoiceId: z.string().min(1).optional(),
  }).refine((v) => !!v.bookingId !== !!v.invoiceId, "Provide one of bookingId or invoiceId")
    .safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: "Invalid request" });
  const { bookingId, invoiceId } = parsed.data;

  const p = bookingId
    ? await db.prepare(
        "SELECT id, intent_id, amount, status, refunded_amount FROM payments WHERE booking_id = ? AND kind = 'booking'"
      ).get(bookingId) as PaymentRow | undefined
    : await db.prepare(
        "SELECT id, intent_id, amount, status, refunded_amount FROM payments WHERE invoice_id = ? AND kind = 'invoice'"
      ).get(invoiceId!) as PaymentRow | undefined;

  if (!p) return reply.code(404).send({ error: "No payment found to refund" });
  if (p.status !== "succeeded") return reply.code(409).send({ error: "That payment never completed" });
  if (Number(p.refunded_amount) >= Number(p.amount))
    return reply.code(409).send({ error: "That payment has already been refunded" });

  try {
    await stripeAccount().refunds.create(
      { payment_intent: p.intent_id },
      { idempotencyKey: `refund:${p.intent_id}` }
    );
  } catch (err) {
    req.log.error({ err }, "refund failed");
    return reply.code(502).send({ error: "Could not refund that payment" });
  }

  /* the webhook confirms it, but recording it now stops a second press
     starting another refund */
  await db.prepare(
    "UPDATE payments SET status = 'refunded', refunded_amount = amount, updated_at = ? WHERE id = ?"
  ).run(now(), p.id);
  if (bookingId) {
    await db.prepare(
      "UPDATE bookings SET payment_status = 'unpaid', prepaid_amount = 0 WHERE id = ?"
    ).run(bookingId);
  }

  return { ok: true, refunded: Number(p.amount) };
});

/* ------------------------------------------------------------------ */
/* Stripe webhooks.                                                    */
/*                                                                     */
/* Needs the raw body to verify the signature, so JSON parsing is       */
/* turned off for this one route.                                      */
/* ------------------------------------------------------------------ */
app.addContentTypeParser("application/json", { parseAs: "buffer" }, (req, body, done) => {
  if (req.url.startsWith("/webhook")) return done(null, body); // keep it raw
  try {
    done(null, JSON.parse(body.toString("utf8")));
  } catch {
    done(new Error("Invalid JSON"), undefined);
  }
});

app.post("/webhook", async (req, reply) => {
  if (!config.stripe.webhookSecret) {
    req.log.error("STRIPE_WEBHOOK_SECRET not set — refusing webhooks");
    return reply.code(503).send({ error: "Webhooks not configured" });
  }
  const signature = req.headers["stripe-signature"];
  if (typeof signature !== "string") return reply.code(400).send({ error: "Missing signature" });

  let event: Stripe.Event;
  try {
    event = stripeAccount().webhooks.constructEvent(
      req.body as Buffer, signature, config.stripe.webhookSecret
    );
  } catch {
    /* Anyone can POST here. Without a valid signature it is not Stripe. */
    return reply.code(400).send({ error: "Bad signature" });
  }

  /* Record first. If this event has been seen, acknowledge and stop —
     Stripe retries, and a retry must not pay or refund anything twice. */
  const seen = await db.prepare(
    "INSERT INTO webhook_events (id, type, payment_intent, received_at) VALUES (?,?,?,?) ON CONFLICT (id) DO NOTHING"
  ).run(event.id, event.type, (event.data.object as { id?: string }).id ?? null, now());
  if (seen.changes === 0) {
    req.log.info({ eventId: event.id }, "duplicate webhook ignored");
    return { received: true, duplicate: true };
  }

  try {
    await handleEvent(event);
  } catch (err) {
    req.log.error({ err, eventId: event.id }, "webhook handling failed");
    /* Let Stripe retry: remove the marker so the retry is not treated as a
       duplicate of a delivery we never actually finished. */
    await db.prepare("DELETE FROM webhook_events WHERE id = ?").run(event.id);
    return reply.code(500).send({ error: "Handling failed" });
  }

  return { received: true };
});

async function handleEvent(event: Stripe.Event) {
  switch (event.type) {
    case "payment_intent.succeeded": {
      const intent = event.data.object as Stripe.PaymentIntent;
      await db.transaction(async (tx) => {
        const p = (await tx.query(
          "SELECT id, kind, order_id, booking_id, invoice_id, amount FROM payments WHERE intent_id = ? FOR UPDATE",
          [intent.id]
        )).rows[0] as { id: string; kind: string; order_id: string | null; booking_id: string | null; invoice_id: string | null; amount: number } | undefined;
        if (!p) return; // not ours

        await tx.query(
          "UPDATE payments SET status = 'succeeded', updated_at = ? WHERE id = ?",
          [now(), p.id]
        );

        if (p.kind === "order" && p.order_id) {
          await tx.query(
            "UPDATE orders SET status = 'paid', updated_at = ? WHERE id = ? AND status = 'placed'",
            [now(), p.order_id]
          );
        }
        if (p.kind === "booking" && p.booking_id) {
          await tx.query(
            "UPDATE bookings SET payment_status = 'prepaid', prepaid_amount = ?, paid = 1, updated_at = ? WHERE id = ?",
            [Number(p.amount), now(), p.booking_id]
          );
        }
        if (p.kind === "invoice" && p.invoice_id) {
          await tx.query(
            "UPDATE invoices SET settled = 1, settled_at = ? WHERE id = ?",
            [now(), p.invoice_id]
          );
        }
      });
      break;
    }

    case "payment_intent.payment_failed": {
      const intent = event.data.object as Stripe.PaymentIntent;
      await db.prepare(
        "UPDATE payments SET status = 'failed', failure_reason = ?, updated_at = ? WHERE intent_id = ?"
      ).run(intent.last_payment_error?.message ?? "Payment failed", now(), intent.id);
      break;
    }

    case "charge.refunded": {
      const charge = event.data.object as Stripe.Charge;
      const intentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
      if (!intentId) break;
      await db.prepare(
        `UPDATE payments SET refunded_amount = ?, status = CASE WHEN ? >= amount THEN 'refunded' ELSE status END,
           updated_at = ? WHERE intent_id = ?`
      ).run(toMajor(charge.amount_refunded), toMajor(charge.amount_refunded), now(), intentId);
      break;
    }

    default:
      /* Everything else is noise for us; acknowledging it stops Stripe
         retrying events we will never care about. */
      break;
  }
}

await app.listen({ port: config.port, host: config.host });
app.log.info(
  `payments service up · ${config.currency.toUpperCase()} · booking: ` +
  [config.booking.payNowEnabled && "pay in full now", config.booking.payLaterEnabled && "pay after the visit"]
    .filter(Boolean).join(" or ")
);
