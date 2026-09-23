package com.cursorpoc.backend.service;

/**
 * SIFEN HU-02 AC-07: one department+city combination from the official DNIT geographic catalog
 * ("Código de Referencia Geográfica", published at dnit.gov.py/web/e-kuatia/tablas-y-codificaciones
 * — same source HU-13's Adenda already used to fix the emisor's own department/city codes).
 * Distrito/barrio granularity exists in the source catalog but isn't modeled here — SIFEN's
 * receiver fields (D219/D223) only need department+city, matching the issuer's own {@link
 * SifenIssuerData} fields.
 */
public record SifenGeographicLocality(
    String departmentCode, String departmentName, String cityCode, String cityName) {}
