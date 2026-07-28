package com.cursorpoc.backend.service;

import java.time.LocalDateTime;
import org.w3c.dom.Document;

/**
 * HU-04: a {@code <rDE>} document after {@link SifenDocumentSigningService} has signed it. {@code
 * document} carries the {@code <Signature>} element as a sibling of {@code <DE>} — pass it to
 * {@link SifenDocumentSigningService#verify} to check it, or to {@link
 * SifenDocumentXmlService#serialize} to get the XML string HU-06 will send to SIFEN.
 */
public record SifenSignedDocument(
    Document document, String controlNumber, LocalDateTime signedAt) {}
