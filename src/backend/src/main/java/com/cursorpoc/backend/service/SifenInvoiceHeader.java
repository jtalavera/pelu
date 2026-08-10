package com.cursorpoc.backend.service;

import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * SIFEN HU-02: identificación, timbrado, emisor y receptor de una factura, listos para que HU-03
 * agregue el detalle de servicios y HU-04 firme el documento completo.
 *
 * @param controlNumber CDC de 44 caracteres (HU-01), AC-01.
 * @param issueDateTime D002/dFeEmiDE — fecha y hora de emisión del DE, en la zona horaria de
 *     negocio (no UTC) — SIFEN HU-04.
 * @param testEnvironmentNotice si {@code true}, el documento corre en ambiente de prueba y {@link
 *     SifenIssuerData#businessName()} ya contiene la leyenda obligatoria en vez de la razón social
 *     real (AC-08).
 */
public record SifenInvoiceHeader(
    String controlNumber,
    LocalDateTime issueDateTime,
    String stampNumber,
    int establishment,
    int expeditionPoint,
    /** C008/dFeIniT — SIFEN HU-04. */
    LocalDate stampValidFrom,
    /** C009/dFeFinT — SIFEN HU-04. */
    LocalDate stampValidUntil,
    SifenIssuerData issuer,
    SifenReceiverData receiver,
    boolean testEnvironmentNotice) {}
