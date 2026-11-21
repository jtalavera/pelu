package com.cursorpoc.backend.web.dto;

/** Body of {@code POST /api/invoices/{id}/pdf/email}: both optional. */
public record InvoiceReceiptEmailRequest(String email, String format) {}
