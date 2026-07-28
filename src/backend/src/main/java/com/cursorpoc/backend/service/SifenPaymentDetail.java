package com.cursorpoc.backend.service;

import java.math.BigDecimal;

/**
 * SIFEN HU-03 AC-06: one payment method used on a cash sale — Manual Técnico V150, grupo E7.1
 * ({@code gPaConEIni}).
 *
 * @param typeCode E606/iTiPago.
 * @param amount amount paid with this method.
 */
public record SifenPaymentDetail(int typeCode, BigDecimal amount) {}
