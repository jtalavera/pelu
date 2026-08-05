package com.cursorpoc.backend.service;

import com.cursorpoc.backend.domain.enums.ClientIdentityDocumentType;

/**
 * SIFEN HU-02: datos del cliente como receptor del documento. Todos los campos son nullable — un
 * consumidor final sin RUC (AC-04) produce una instancia con todo en {@code null} salvo, quizás,
 * {@code name}.
 *
 * @param departmentCode D219/cDepRec — SIFEN HU-02 AC-07, código DNIT del departamento.
 * @param departmentName D220/dDesDepRec — nombre correspondiente a {@code departmentCode}.
 * @param cityCode D223/cCiuRec — SIFEN HU-02 AC-07, código DNIT de la ciudad.
 * @param cityName D224/dDesCiuRec — nombre correspondiente a {@code cityCode}.
 * @param identityDocumentType Tipo de identificación ya resuelto (nunca null: {@link
 *     ClientIdentityDocumentType#resolve} garantiza un valor concreto, incluyendo {@code
 *     INNOMINADO} cuando no hay ni RUC ni documento).
 */
public record SifenReceiverData(
    String ruc,
    String identityDocumentNumber,
    String name,
    String address,
    String departmentCode,
    String departmentName,
    String cityCode,
    String cityName,
    ClientIdentityDocumentType identityDocumentType) {}
