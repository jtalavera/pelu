package com.cursorpoc.backend.service;

import com.cursorpoc.backend.domain.enums.CardBrand;
import java.math.BigDecimal;

/**
 * SIFEN HU-03 AC-06: one payment method used on a cash sale — Manual Técnico V150, grupo E7.1
 * ({@code gPaConEIni}).
 *
 * @param typeCode E606/iTiPago.
 * @param amount amount paid with this method.
 * @param cardBrand E621/iDenTarj, only set when {@code typeCode} is 3 (Tarjeta de crédito) or 4
 *     (Tarjeta de débito) — issue #170: SIFEN rejects card payments missing the mandatory
 *     E7.1.1/gPagTarCD group.
 * @param cardBrandOtherDescription E622/dDesDenTarj free-text override, only set when {@code
 *     cardBrand} is {@link CardBrand#OTHER}.
 */
public record SifenPaymentDetail(
    int typeCode, BigDecimal amount, CardBrand cardBrand, String cardBrandOtherDescription) {}
