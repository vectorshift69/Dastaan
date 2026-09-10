/* ------------------------------------------------------------------ */
/* Auto-invoicing (PRD 9): an invoice is generated and sent            */
/* automatically the moment a service is checked out — no manual step. */
/* UAE VAT 5%, prices treated as VAT-inclusive; tip is outside VAT.    */
/* ------------------------------------------------------------------ */

import { db, uid, now, nextCounter } from "./db.js";
import { config } from "./config.js";

/* one rate, from config — a rate change must not mean hunting through files */
const VAT_RATE = config.business.vatRate;

export type InvoiceInput = {
  price: number;      // service total before discount (editable at POS per PRD 11)
  discount: number;   // manual discount (default 0, set at bill time)
  tip: number;
  method: string;
  issuedBy: string;
  couponCode?: string | null;
  couponDiscount?: number; // computed server-side by the coupon engine
  /* retail products sold alongside the service (PRD 11 combined checkout).
     Priced server-side from the catalog — never trusted from the client. */
  productLines?: { productId: string; name: string; qty: number; price: number }[];
  /* cash / split tracking */
  cashReceived?: number;   // cash note the client handed over
  cashChange?: number;     // change given back
  cashToWallet?: number;   // change added to client credit wallet
  cashToTip?: number;      // change tipped to the barber
  splitDetail?: { cash: number; card: number; [k: string]: number }; // breakdown for Split payments
};

export type Invoice = {
  id: string;
  invoiceNo: string;
  bookingId: string;
  clientName: string;
  barberName: string;
  issuedByName: string;
  items: { name: string; price: number }[];
  gross: number;
  discount: number;
  tip: number;
  vat: number;
  total: number;
  paymentMethod: string;
  /* how a Split payment broke down between cash and card — undefined for
     every other method, since there is nothing to split. */
  splitDetail?: { cash: number; card: number; [k: string]: number };
  couponCode: string | null;
  createdAt: string;
  /* The supplier, as a UAE tax invoice has to identify them. Part of the
     type rather than something screens look up, so a new screen showing a
     bill cannot forget the TRN. */
  business: { legalName: string; trn: string; vatRate: number };
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export async function createInvoiceForBooking(bookingId: string, input: InvoiceInput): Promise<Invoice> {
  const b = await db
    .prepare(
      "SELECT id, branch_id, barber_id, client_name, client_phone, service_ids FROM bookings WHERE id = ?"
    )
    .get(bookingId) as
    | { id: string; branch_id: string; barber_id: string; client_name: string; client_phone: string | null; service_ids: string }
    | undefined;
  if (!b) throw Object.assign(new Error("Booking not found"), { statusCode: 404 });

  const existing = await db.prepare("SELECT id FROM invoices WHERE booking_id = ?").get(bookingId);
  if (existing)
    throw Object.assign(new Error("This booking already has an invoice"), { statusCode: 409 });

  const barber = await db.prepare("SELECT name FROM users WHERE id = ?").get(b.barber_id) as
    | { name: string } | undefined;
  const issuer = await db.prepare("SELECT name FROM users WHERE id = ?").get(input.issuedBy) as
    | { name: string } | undefined;
  const barberName = barber?.name ?? "—";
  const issuedByName = issuer?.name ?? "—";

  const serviceIds = JSON.parse(b.service_ids) as string[];
  const items: { name: string; price: number }[] = [];
  for (const sid of serviceIds) {
    const s = await db.prepare("SELECT name, price FROM services WHERE id = ?").get(sid) as
      | { name: string; price: number }
      | undefined;
    items.push({ name: s?.name ?? "Service", price: Number(s?.price ?? 0) });
  }

  // products appear as their own invoice lines, e.g. "2× Argan Repair Serum"
  const productTotal = (input.productLines ?? []).reduce((sum, p) => sum + p.price * p.qty, 0);
  for (const p of input.productLines ?? []) {
    items.push({ name: p.qty > 1 ? `${p.qty}× ${p.name}` : p.name, price: r2(p.price * p.qty) });
  }

  const totalDiscount = r2(input.discount + (input.couponDiscount ?? 0));
  const gross = r2(Math.max(0, input.price + productTotal - totalDiscount)); // VAT-inclusive
  const vat = r2((gross * VAT_RATE) / (1 + VAT_RATE));
  const total = r2(gross + input.tip);

  const year = new Date().getFullYear();
  const invoiceNo = `INV-${year}-${String(await nextCounter(`invoice:${year}`)).padStart(5, "0")}`;

  const id = uid();
  await db.prepare(
    `INSERT INTO invoices (id, invoice_no, booking_id, branch_id, client_name, client_phone,
       items, gross, discount, tip, vat, total, payment_method, issued_by, coupon_code, created_at,
       cash_received, cash_change, cash_to_wallet, cash_to_tip, split_detail,
       barber_id, barber_name, issued_by_name)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    id, invoiceNo, b.id, b.branch_id, b.client_name, b.client_phone,
    JSON.stringify(items), gross, totalDiscount, r2(input.tip), vat, total,
    input.method, input.issuedBy, input.couponCode ?? null, now(),
    input.cashReceived ?? null,
    input.cashChange ?? null,
    input.cashToWallet ?? null,
    input.cashToTip ?? null,
    input.splitDetail ? JSON.stringify(input.splitDetail) : null,
    b.barber_id, barberName, issuedByName,
  );

  return {
    id, invoiceNo, bookingId: b.id, clientName: b.client_name, barberName, issuedByName, items,
    gross, discount: totalDiscount, tip: r2(input.tip), vat, total,
    paymentMethod: input.method, splitDetail: input.splitDetail, couponCode: input.couponCode ?? null, createdAt: now(),
    /* same block as invoiceToApi — the desk shows this straight after
       checkout, and that screen calls itself a tax invoice too */
    business: {
      legalName: config.business.legalName,
      trn: config.business.trn,
      vatRate: config.business.vatRate,
    },
  };
}

type InvoiceRow = {
  id: string; invoice_no: string; booking_id: string; branch_id: string;
  client_name: string; client_phone: string | null; items: string;
  gross: number; discount: number; tip: number; vat: number; total: number;
  payment_method: string; coupon_code: string | null; created_at: string;
  barber_name: string | null; issued_by_name: string | null; split_detail: string | null;
};

export const invoiceToApi = (r: InvoiceRow) => ({
  id: r.id,
  invoiceNo: r.invoice_no,
  bookingId: r.booking_id,
  branchId: r.branch_id,
  clientName: r.client_name,
  barberName: r.barber_name ?? "—",
  issuedByName: r.issued_by_name ?? "—",
  items: JSON.parse(r.items) as { name: string; price: number }[],
  gross: r.gross,
  discount: r.discount,
  tip: r.tip,
  vat: r.vat,
  total: r.total,
  paymentMethod: r.payment_method,
  splitDetail: r.split_detail ? (JSON.parse(r.split_detail) as { cash: number; card: number }) : undefined,
  couponCode: r.coupon_code,
  createdAt: r.created_at,
  /* Whoever renders this — the console, the client's account, a PDF — is
     showing a tax invoice, and a tax invoice without the supplier's TRN is
     not a valid one. Sent with the invoice so no screen has to remember. */
  business: {
    legalName: config.business.legalName,
    trn: config.business.trn,
    vatRate: config.business.vatRate,
  },
});
