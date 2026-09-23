package com.cursorpoc.backend.service;

import com.cursorpoc.backend.domain.enums.ClientIdentityDocumentType;
import com.cursorpoc.backend.domain.enums.ClientTaxpayerType;

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
 * @param taxpayerType D205/iTiContRec — solo relevante cuando {@code identityDocumentType} resuelve
 *     a {@code RUC}. Puede ser {@code null} (p.ej. vía el constructor de compatibilidad de 9
 *     argumentos, usado por casi todos los tests existentes) — {@code SifenDocumentXmlService}
 *     aplica {@link ClientTaxpayerType#PERSONA_FISICA} como valor por defecto en ese caso.
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
    ClientIdentityDocumentType identityDocumentType,
    ClientTaxpayerType taxpayerType) {

  public SifenReceiverData(
      String ruc,
      String identityDocumentNumber,
      String name,
      String address,
      String departmentCode,
      String departmentName,
      String cityCode,
      String cityName,
      ClientIdentityDocumentType identityDocumentType) {
    this(
        ruc,
        identityDocumentNumber,
        name,
        address,
        departmentCode,
        departmentName,
        cityCode,
        cityName,
        identityDocumentType,
        null);
  }
}
