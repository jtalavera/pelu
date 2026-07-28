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
    String economicActivityDescription,
    /** D117/dTelEmi. */
    String phone,
    /** D118/dEmailE. */
    String contactEmail,
    /** D111/cDepEmi — SIFEN HU-04. */
    String departmentCode,
    /** D112/dDesDepEmi — SIFEN HU-04. */
    String departmentName,
    /** D115/cCiuEmi — SIFEN HU-04. */
    String cityCode,
    /** D116/dDesCiuEmi — SIFEN HU-04. */
    String cityName) {}
