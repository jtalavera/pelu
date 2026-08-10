package com.cursorpoc.backend.service;

/**
 * SIFEN HU-07: the outcome of one status query to SIFEN's consulta (SiConsDE) service.
 *
 * @param submissionResult reuses {@link SifenSubmissionResult} (HU-06) so both ways of learning an
 *     invoice's SIFEN status persist through the exact same fields/method (see {@code
 *     SifenInvoiceSubmissionService.recordResult}) — {@code protocolNumber} is always {@code null}
 *     here (see {@link SifenDocumentQueryClient} class Javadoc for why).
 * @param documentContent AC-03: the full {@code xContenDE} SIFEN returns when the CDC is found —
 *     {@code null} when not found/rejected (SIFEN only returns it alongside {@code dCodRes=0422}).
 */
public record SifenQueryResult(SifenSubmissionResult submissionResult, String documentContent) {}
