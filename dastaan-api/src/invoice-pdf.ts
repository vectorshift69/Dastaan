/* Branded, downloadable tax-invoice PDF (A5 receipt style). */

import PDFDocument from "pdfkit";
import { db } from "./db.js";
import type { invoiceToApi } from "./invoices.js";

type ApiInvoice = ReturnType<typeof invoiceToApi>;

const INK = "#141414";
const GOLD = "#b8912f";
const GRAY = "#6b6b6b";
const LIGHT = "#e8e4d8";

export function renderInvoicePdf(inv: ApiInvoice): Promise<Buffer> {
  const branch = db
    .prepare("SELECT name, area, address, phone FROM branches WHERE id = ?")
    .get(inv.branchId) as { name: string; area: string; address: string; phone: string };

  const doc = new PDFDocument({ size: "A5", margins: { top: 48, bottom: 48, left: 44, right: 44 } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  const W = doc.page.width - 88; // content width

  /* header */
  doc.fillColor(INK).font("Times-Bold").fontSize(26).text("DASTAAN", { characterSpacing: 6 });
  doc.moveDown(0.1);
  doc.rect(44, doc.y + 2, 90, 2).fill(GOLD);
  doc.moveDown(0.6);
  doc.fillColor(GRAY).font("Helvetica").fontSize(8.5)
    .text(branch.name)
    .text(`${branch.address} · ${branch.area}`)
    .text(branch.phone);

  /* invoice meta */
  doc.moveDown(1.2);
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(13).text("TAX INVOICE");
  doc.moveDown(0.3);
  const metaY = doc.y;
  doc.font("Helvetica").fontSize(9).fillColor(GRAY);
  doc.text(`Invoice no.`, 44, metaY, { continued: true }).fillColor(INK).font("Helvetica-Bold")
    .text(`  ${inv.invoiceNo}`);
  doc.fillColor(GRAY).font("Helvetica")
    .text(`Date`, 44, doc.y + 2, { continued: true }).fillColor(INK).font("Helvetica-Bold")
    .text(`  ${new Date(inv.createdAt).toLocaleString("en-AE", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })}`);
  doc.fillColor(GRAY).font("Helvetica")
    .text(`Billed to`, 44, doc.y + 2, { continued: true }).fillColor(INK).font("Helvetica-Bold")
    .text(`  ${inv.clientName}`);
  doc.fillColor(GRAY).font("Helvetica")
    .text(`Payment`, 44, doc.y + 2, { continued: true }).fillColor(INK).font("Helvetica-Bold")
    .text(`  ${inv.paymentMethod}`);

  /* items table */
  doc.moveDown(1.2);
  const thY = doc.y;
  doc.rect(44, thY, W, 18).fill(INK);
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(8)
    .text("SERVICE", 52, thY + 5)
    .text("AED", 44 + W - 60, thY + 5, { width: 52, align: "right" });
  let y = thY + 18;
  doc.font("Helvetica").fontSize(9.5);
  for (const [i, item] of inv.items.entries()) {
    if (i % 2 === 1) doc.rect(44, y, W, 20).fill("#f6f4ee");
    doc.fillColor(INK)
      .text(item.name, 52, y + 5, { width: W - 80 })
      .text(item.price.toFixed(2), 44 + W - 60, y + 5, { width: 52, align: "right" });
    y += 20;
  }
  doc.moveTo(44, y).lineTo(44 + W, y).strokeColor(LIGHT).lineWidth(1).stroke();

  /* totals */
  y += 10;
  const row = (label: string, value: string, opts?: { bold?: boolean; gold?: boolean }) => {
    doc.font(opts?.bold ? "Helvetica-Bold" : "Helvetica").fontSize(opts?.bold ? 11 : 9)
      .fillColor(opts?.gold ? GOLD : opts?.bold ? INK : GRAY)
      .text(label, 44 + W - 200, y, { width: 130, align: "right" })
      .text(value, 44 + W - 66, y, { width: 58, align: "right" });
    y += opts?.bold ? 20 : 15;
  };
  if (inv.discount > 0) row("Discount", `-${inv.discount.toFixed(2)}`);
  row("Subtotal (excl. VAT)", (inv.gross - inv.vat).toFixed(2));
  row("VAT 5%", inv.vat.toFixed(2));
  if (inv.tip > 0) row("Tip", inv.tip.toFixed(2));
  y += 4;
  doc.moveTo(44 + W - 200, y - 2).lineTo(44 + W, y - 2).strokeColor(GOLD).lineWidth(1).stroke();
  y += 4;
  row("TOTAL PAID", `AED ${inv.total.toFixed(2)}`, { bold: true, gold: false });

  /* footer */
  doc.fontSize(8).fillColor(GRAY).font("Helvetica")
    .text("Prices are inclusive of 5% UAE VAT. Generated automatically by the Dastaan platform.",
      44, doc.page.height - 84, { width: W, align: "center" })
    .fillColor(GOLD).font("Times-Italic").fontSize(9)
    .text("Every cut tells a story.", 44, doc.page.height - 68, { width: W, align: "center" });

  doc.end();
  return done;
}
