package com.cursorpoc.backend.service;

import java.time.LocalDateTime;
import org.w3c.dom.Document;

/**
 * HU-04: a {@code <rDE>} document after {@link SifenDocumentSigningService} has signed it. {@code
 * document} carries the {@code <Signature>} element as a sibling of {@code <DE>} — pass it to
 * {@link SifenDocumentSigningService#verify} to check it, or to {@link
 * SifenDocumentXmlService#serialize} to get the XML string HU-06 will send to SIFEN.
 *
 * @param qrUrl SIFEN HU-08: the same URL persisted in the document's own {@code gCamFuFD/dCarQR} —
 *     exposed here so HU-08's KuDE renderer and HU-09's revalidation button never need to recompute
 *     or re-derive it from the DOM.
 * @param publicConsultationUrl SIFEN HU-08 AC-10/AC-15: the environment's public consultation site
 *     (no document-specific query string), for display next to the CDC.
 */
public record SifenSignedDocument(
    Document document,
    String controlNumber,
    LocalDateTime signedAt,
    String qrUrl,
    String publicConsultationUrl) {}
