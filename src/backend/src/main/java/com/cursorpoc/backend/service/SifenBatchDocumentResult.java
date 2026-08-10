package com.cursorpoc.backend.service;

import com.cursorpoc.backend.domain.enums.SifenSubmissionStatus;

/**
 * SIFEN HU-15: one document's final result within a processed batch, parsed from {@code
 * gResProcLote} (Manual Técnico V150 sección 9.3.3; live {@code consulta-lote.wsdl.xsd1.xsd}'s
 * {@code tgResProcLote}) by {@link SifenBatchResultQueryClient}. Only meaningful when the enclosing
 * {@link SifenBatchQueryResult#concluded()}.
 */
public record SifenBatchDocumentResult(
    String cdc, SifenSubmissionStatus status, String resultCode, String message) {}
