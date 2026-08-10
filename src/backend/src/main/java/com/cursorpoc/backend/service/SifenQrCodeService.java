package com.cursorpoc.backend.service;

import com.cursorpoc.backend.config.SifenConnectionProperties;
import com.cursorpoc.backend.config.SifenQrProperties;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.format.DateTimeFormatter;
import org.springframework.stereotype.Service;

/**
 * SIFEN HU-08: computes the KuDE/DE QR code's data — Manual Técnico V150 sección 13.8.2/13.8.3
 * ("Conformación del Código QR" / "Metodología para la generación del Código QR"). Shared by {@link
 * SifenDocumentSigningService} (which appends the resulting URL as {@code gCamFuFD/dCarQR} in the
 * signed DE — the field SIFEN's schema rejected every prior document for lacking, per HU-06/HU-07's
 * documented findings) and the KuDE PDF renderer (HU-08's own AC-13/AC-14), so both always encode
 * the exact same URL for a given document.
 *
 * <p><b>Verified against the manual's own worked example</b> (sección 13.8.4), reproduced verbatim
 * as {@code SifenQrCodeServiceTest}'s primary regression case — CDC, DigestValue, totals and CSC
 * from that example hash to the exact {@code cHashQR} the manual shows, confirming: (a) "hex
 * equivalent" of a field means hex-encoding the UTF-8 bytes of its literal text (not decoding
 * base64 first — confirmed by round-tripping the manual's own DigestValue/date examples), (b) the
 * SHA-256 input is the ordered query string plus the raw CSC appended with no separator, (c) the
 * final hash is lowercase hex.
 *
 * <p>The production/test base URL and the receiver-id parameter name (dRucRec vs dNumIDRec, {@link
 * SifenReceiverIdentification}) were cross-checked against a public, independently maintained SIFEN
 * QR implementation since the manual's single worked example doesn't cover every branch — see
 * {@link SifenReceiverIdentification}'s javadoc.
 */
@Service
public class SifenQrCodeService {

  private static final DateTimeFormatter ISSUE_DATE_TIME_FORMAT =
      DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss");

  private final SifenQrProperties qrProperties;
  private final SifenConnectionProperties connectionProperties;

  public SifenQrCodeService(
      SifenQrProperties qrProperties, SifenConnectionProperties connectionProperties) {
    this.qrProperties = qrProperties;
    this.connectionProperties = connectionProperties;
  }

  /**
   * @param qrUrl the full URL to encode as the QR image and to store verbatim in {@code dCarQR}
   *     (AC-13/AC-14) — {@code &} is literal here; XML serialization escapes it to {@code &amp;} on
   *     its own (Paso 5 of the manual), so callers must never pre-escape it.
   * @param publicConsultationUrl SIFEN's public consultation site for the active environment,
   *     without any document-specific query string (AC-10) — test or production per {@link
   *     SifenConnectionProperties#activeEnvironment()} (AC-15).
   * @param productionEnvironment {@code true} if this QR points at the production consultation site
   *     — HU-08 AC-15 needs to know this to decide whether the "sin valor comercial" legend
   *     applies.
   */
  public record SifenQrResult(
      String qrUrl, String publicConsultationUrl, boolean productionEnvironment) {}

  /**
   * @param itemCount cItems — count of {@code gCamItem} occurrences (E701), i.e. {@code
   *     detail.lines().size()}, not derived from totals.
   * @param digestValueBase64 XS17/DigestValue exactly as it appears (base64) in the just-produced
   *     {@code <Signature>} — the caller (the signing service) must extract it post-signing, since
   *     the QR can only be computed once a signature exists to reference.
   */
  public SifenQrResult build(
      SifenInvoiceHeader header,
      SifenInvoiceTotals totals,
      int itemCount,
      String digestValueBase64) {
    return build(header, totals, itemCount, digestValueBase64, false);
  }

  /**
   * SIFEN HU-14 gap found live (dCodRes=2500, "cadena de caracteres correspondiente al código QR no
   * es coincidente con el archivo XML"): the QR hash must reflect exactly what the DE itself
   * reports, and {@code buildTotals} zeroes {@code dTotIVA} for autofactura (dCodRes=2353/2377 —
   * there's no {@code gCamIVA} to cross-check it against) — the QR must zero it too, or the two
   * stop matching.
   */
  public SifenQrResult build(
      SifenInvoiceHeader header,
      SifenInvoiceTotals totals,
      int itemCount,
      String digestValueBase64,
      boolean isAutoInvoice) {
    boolean production =
        connectionProperties.activeEnvironment()
            == SifenConnectionProperties.Environment.PRODUCTION;
    String qrBase =
        production ? qrProperties.getProductionQrBaseUrl() : qrProperties.getTestQrBaseUrl();
    String consultationUrl =
        production
            ? qrProperties.getProductionPublicConsultationUrl()
            : qrProperties.getTestPublicConsultationUrl();

    SifenReceiverIdentification.Resolved receiverId =
        SifenReceiverIdentification.resolve(header.receiver());

    String query =
        "nVersion=150"
            + "&Id="
            + header.controlNumber()
            + "&dFeEmiDE="
            + hexEncode(header.issueDateTime().format(ISSUE_DATE_TIME_FORMAT))
            + "&"
            + receiverId.paramName()
            + "="
            + receiverId.value()
            + "&dTotGralOpe="
            + totals.netTotal().toPlainString()
            + "&dTotIVA="
            + (isAutoInvoice ? "0" : totals.totalIva().toPlainString())
            + "&cItems="
            + itemCount
            + "&DigestValue="
            + hexEncode(digestValueBase64)
            + "&IdCSC="
            + pad4(qrProperties.getActiveCscId());

    String hash = sha256Hex(query + qrProperties.activeCscSecret());
    String qrUrl = qrBase + query + "&cHashQR=" + hash;
    return new SifenQrResult(qrUrl, consultationUrl, production);
  }

  /** Manual Técnico V150 sección 13.8.3: hex-encode the UTF-8 bytes of the field's literal text. */
  private static String hexEncode(String text) {
    byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
    StringBuilder sb = new StringBuilder(bytes.length * 2);
    for (byte b : bytes) {
      sb.append(String.format("%02x", b));
    }
    return sb.toString();
  }

  private static String sha256Hex(String input) {
    try {
      MessageDigest digest = MessageDigest.getInstance("SHA-256");
      byte[] hash = digest.digest(input.getBytes(StandardCharsets.UTF_8));
      StringBuilder sb = new StringBuilder(hash.length * 2);
      for (byte b : hash) {
        sb.append(String.format("%02x", b));
      }
      return sb.toString();
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException("SHA-256 not available", e);
    }
  }

  private static String pad4(int idCsc) {
    return String.format("%04d", idCsc);
  }
}
