package com.cursorpoc.backend.service;

import com.cursorpoc.backend.util.ParaguayRucValidator;

/**
 * SIFEN HU-08: resolves which receiver-identification field (D206/dRucRec or D210/dNumIDRec) and
 * value the QR code's hash/URL must reference — Manual Técnico V150 sección 13.8.2, fila
 * "dRucRec/dNumIDRec" (ID Campo "D206 o D210"). The manual's own worked example only shows the RUC
 * case; a cross-check against a public, independently-maintained SIFEN QR generator
 * (TIPS-SA/facturacionelectronicapy-qrgen, {@code src/QRGen.ts}) confirmed the parameter name
 * itself switches to {@code dNumIDRec} — not just its value — whenever the receiver has no RUC,
 * including the fully-anonymous case (value {@code "0"}, mirroring the "(*) blank field → 0" rule
 * the manual states for the other optional QR parameters).
 *
 * <p><b>Must stay in sync with {@link SifenDocumentXmlService#buildReceiver}</b>, which decides the
 * exact same RUC/documento/anónimo branching for the DE's own D205-D223 receiver group — the QR
 * hash is only valid if it references literally the same field/value pair that ended up in the
 * signed document. Kept as a small shared utility (not a full refactor of {@code buildReceiver}) so
 * this HU-08 addition can't silently diverge from HU-02's already-tested receiver logic.
 */
final class SifenReceiverIdentification {

  private SifenReceiverIdentification() {}

  record Resolved(String paramName, String value) {}

  static Resolved resolve(SifenReceiverData receiver) {
    String ruc = receiver.ruc();
    if (ruc != null && !ruc.isBlank()) {
      return new Resolved("dRucRec", ParaguayRucValidator.split(ruc).base());
    }
    String identityDocument = receiver.identityDocumentNumber();
    if (identityDocument != null && !identityDocument.isBlank()) {
      return new Resolved("dNumIDRec", identityDocument);
    }
    return new Resolved("dNumIDRec", "0");
  }
}
