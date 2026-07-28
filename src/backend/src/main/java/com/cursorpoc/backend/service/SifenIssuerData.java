package com.cursorpoc.backend.service;

import com.cursorpoc.backend.domain.enums.SifenTaxpayerType;

/**
 * SIFEN HU-02 AC-03: datos de la peluquería como emisor del documento, tal como están registrados
 * ante la DNIT.
 *
 * @param businessName razón social del emisor (D105/dNomEmi) — en ambiente de prueba, reemplazado
 *     por la leyenda obligatoria (AC-08); ver {@link SifenInvoiceHeaderService}.
 */
public record SifenIssuerData(
    String ruc,
    int rucCheckDigit,
    String businessName,
    String address,
    SifenTaxpayerType taxpayerType,
    String economicActivityCode,
    String economicActivityDescription) {}
