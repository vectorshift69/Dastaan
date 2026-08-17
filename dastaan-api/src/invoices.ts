/* ------------------------------------------------------------------ */
/* Auto-invoicing (PRD 9): an invoice is generated and sent            */
/* automatically the moment a service is checked out — no manual step. */
/* UAE VAT 5%, prices treated as VAT-inclusive; tip is outside VAT.    */
/* ------------------------------------------------------------------ */

import { db, uid, now, nextCounter } from "./db.js";

const VAT_RATE = 0.05;

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
};

export type Invoice = {
  id: string;
  invoiceNo: string;
  bookingId: string;
  clientName: string;
  items: { name: string; price: number }[];
  gross: number;
  discount: number;
  tip: number;
  vat: number;
  total: number;
  paymentMethod: string;
  couponCode: string | null;
  createdAt: string;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export async function createInvoiceForBooking(bookingId: string, input: InvoiceInput): Promise<Invoice> {
  const b = await db
    .prepare(
      "SELECT id, branch_id, client_name, client_phone, service_ids FROM bookings WHERE id = ?"
    )
    .get(bookingId) as
    | { id: string; branch_id: string; client_name: string; client_phone: string | null; service_ids: string }
    | undefined;
  if (!b) throw Object.assign(new Error("Booking not found"), { statusCode: 404 });

  const existing = await db.prepare("SELECT id FROM invoices WHERE booking_id = ?").get(bookingId);
  if (existing)
    throw Object.assign(new Error("This booking already has an invoice"), { statusCode: 409 });

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
       items, gross, discount, tip, vat, total, payment_method, issued_by, coupon_code, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    id, invoiceNo, b.id, b.branch_id, b.client_name, b.client_phone,
    JSON.stringify(items), gross, totalDiscount, r2(input.tip), vat, total,
    input.method, input.issuedBy, input.couponCode ?? null, now()
  );

  return {
    id, invoiceNo, bookingId: b.id, clientName: b.client_name, items,
    gross, discount: totalDiscount, tip: r2(input.tip), vat, total,
    paymentMethod: input.method, couponCode: input.couponCode ?? null, createdAt: now(),
  };
}

type InvoiceRow = {
  id: string; invoice_no: string; booking_id: string; branch_id: string;
  client_name: string; client_phone: string | null; items: string;
  gross: number; discount: number; tip: number; vat: number; total: number;
  payment_method: string; coupon_code: string | null; created_at: string;
};

export const invoiceToApi = (r: InvoiceRow) => ({
  id: r.id,
  invoiceNo: r.invoice_no,
  bookingId: r.booking_id,
  branchId: r.branch_id,
  clientName: r.client_name,
  items: JSON.parse(r.items) as { name: string; price: number }[],
  gross: r.gross,
  discount: r.discount,
  tip: r.tip,
  vat: r.vat,
  total: r.total,
  paymentMethod: r.payment_method,
  couponCode: r.coupon_code,
  createdAt: r.created_at,
});
