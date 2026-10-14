package com.cursorpoc.backend.stock;

import com.cursorpoc.backend.domain.Invoice;

/**
 * Stock integration (HU-63/HU-64): published synchronously inside the transaction that issued,
 * voided or corrected an invoice, so {@link StockDomainEventListener} writes the outbox event in
 * that same transaction.
 */
public record InvoiceStockEvent(Kind kind, Invoice invoice, String reason) {

  public enum Kind {
    /** Issued: product lines leave stock ({@code SALE}). */
    ISSUED,
    /** Voided by any path (manual, SIFEN cancellation, number inutilización): {@code REVERSE}. */
    VOIDED,
    /** A SIFEN-rejected invoice was corrected: reverse the old sale, post the new one. */
    CORRECTED
  }

  public static InvoiceStockEvent issued(Invoice invoice) {
    return new InvoiceStockEvent(Kind.ISSUED, invoice, null);
  }

  public static InvoiceStockEvent voided(Invoice invoice, String reason) {
    return new InvoiceStockEvent(Kind.VOIDED, invoice, reason);
  }

  public static InvoiceStockEvent corrected(Invoice invoice) {
    return new InvoiceStockEvent(Kind.CORRECTED, invoice, null);
  }
}
