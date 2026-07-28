package com.cursorpoc.backend.service;

import java.time.LocalDate;

/**
 * HU-01: the 10 fields SIFEN's Manual Técnico (sección 10.1, "Conformación del CDC") combines to
 * build a document's 44-character número de control (CDC), in the exact order they're concatenated.
 * Raw (unpadded) values are accepted here — {@link SifenControlNumberService#build} does the
 * left-zero-padding (AC-03).
 *
 * @param documentType tipo de Documento Electrónico (C002/iTiDE), e.g. 1 = Factura Electrónica.
 * @param issuerRuc RUC del emisor sin dígito verificador (D101/dRucEm), digits only.
 * @param issuerRucCheckDigit dígito verificador del RUC del emisor (D102/dDVEmi), 0-9.
 * @param establishment establecimiento (C005/dEst).
 * @param expeditionPoint punto de expedición (C006/dPunExp).
 * @param documentNumber número de documento (C007/dNumDoc).
 * @param taxpayerType tipo de contribuyente (D103/iTipCont): 1 = física, 2 = jurídica.
 * @param issueDate fecha de emisión (D002/dFeEmiDE) — formateada como AAAAMMDD.
 * @param emissionType tipo de emisión (B002/iTipEmi): 1 = normal, 2 = contingencia.
 * @param securityCode código de seguridad (B004/dCodSeg), 9 dígitos — ver {@link
 *     SifenControlNumberService#generateSecurityCode}.
 */
public record SifenControlNumberFields(
    int documentType,
    String issuerRuc,
    int issuerRucCheckDigit,
    int establishment,
    int expeditionPoint,
    long documentNumber,
    int taxpayerType,
    LocalDate issueDate,
    int emissionType,
    String securityCode) {}
