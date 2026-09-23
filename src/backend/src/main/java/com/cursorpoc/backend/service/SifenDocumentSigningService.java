package com.cursorpoc.backend.service;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import java.security.InvalidAlgorithmParameterException;
import java.security.NoSuchAlgorithmException;
import java.security.PublicKey;
import java.security.cert.X509Certificate;
import java.time.LocalDateTime;
import java.util.List;
import javax.xml.crypto.AlgorithmMethod;
import javax.xml.crypto.KeySelector;
import javax.xml.crypto.KeySelectorException;
import javax.xml.crypto.KeySelectorResult;
import javax.xml.crypto.MarshalException;
import javax.xml.crypto.XMLCryptoContext;
import javax.xml.crypto.dsig.CanonicalizationMethod;
import javax.xml.crypto.dsig.DigestMethod;
import javax.xml.crypto.dsig.Reference;
import javax.xml.crypto.dsig.SignatureMethod;
import javax.xml.crypto.dsig.SignedInfo;
import javax.xml.crypto.dsig.Transform;
import javax.xml.crypto.dsig.XMLSignature;
import javax.xml.crypto.dsig.XMLSignatureException;
import javax.xml.crypto.dsig.XMLSignatureFactory;
import javax.xml.crypto.dsig.dom.DOMSignContext;
import javax.xml.crypto.dsig.dom.DOMValidateContext;
import javax.xml.crypto.dsig.keyinfo.KeyInfo;
import javax.xml.crypto.dsig.keyinfo.KeyInfoFactory;
import javax.xml.crypto.dsig.keyinfo.X509Data;
import javax.xml.crypto.dsig.spec.C14NMethodParameterSpec;
import javax.xml.crypto.dsig.spec.TransformParameterSpec;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

/**
 * SIFEN HU-04: signs the {@code <DE>} element of an {@code <rDE>} document with XML-DSig, per
 * Manual Técnico V150 sección 7.6/7.7 (Estándar de firma digital) — enveloped signature, standard
 * (inclusive) C14N for {@code SignedInfo}, exclusive C14N as the reference transform, RSA-SHA256,
 * {@code KeyInfo} carrying only the X.509 certificate (the manual explicitly forbids
 * X509SubjectName/X509IssuerSerial/X509IssuerName/X509SKI/KeyValue — those are already implied by
 * the certificate itself).
 *
 * <p>Uses {@code javax.xml.crypto.dsig} (JSR 105), built into the JDK — no signing library
 * dependency needed. The algorithm URIs the JDK exposes as named constants ({@link
 * SignatureMethod#RSA_SHA256}, {@link DigestMethod#SHA256}, {@link Transform#ENVELOPED}, {@link
 * CanonicalizationMethod#EXCLUSIVE}/{@link CanonicalizationMethod#INCLUSIVE}) match the manual's
 * Schema XML 1 table (XS04/XS06/XS13/XS16) exactly, confirming this is the standard, current
 * signature level SIFEN expects (AC-04) — not something obsolete or deprecated.
 */
@Service
public class SifenDocumentSigningService {

  private static final Logger log = LoggerFactory.getLogger(SifenDocumentSigningService.class);

  private final SifenCertificateService certificateService;
  private final SifenInvoiceHeaderService headerService;
  private final SifenInvoiceDetailService detailService;
  private final SifenControlNumberService controlNumberService;
  private final SifenDocumentXmlService xmlService;
  private final SifenQrCodeService qrCodeService;
  private final FemmeTimeProperties timeProperties;

  public SifenDocumentSigningService(
      SifenCertificateService certificateService,
      SifenInvoiceHeaderService headerService,
      SifenInvoiceDetailService detailService,
      SifenControlNumberService controlNumberService,
      SifenDocumentXmlService xmlService,
      SifenQrCodeService qrCodeService,
      FemmeTimeProperties timeProperties) {
    this.certificateService = certificateService;
    this.headerService = headerService;
    this.detailService = detailService;
    this.controlNumberService = controlNumberService;
    this.xmlService = xmlService;
    this.qrCodeService = qrCodeService;
    this.timeProperties = timeProperties;
  }

  /**
   * Orchestrator: builds the full document for {@code invoiceId} (HU-02 + HU-03) and signs it with
   * the tenant's active certificate (HU-21). AC-02: resolves the certificate <b>first</b> — if none
   * is valid (expired, or none uploaded), this throws before any document assembly or signing is
   * attempted, let alone a send. AC-06: the certificate/key are always {@link
   * SifenCertificateService#requireActiveCertificate}'s result for this exact tenant, never passed
   * in from elsewhere.
   */
  public SifenSignedDocument signInvoice(long tenantId, long invoiceId) {
    return signInvoice(tenantId, invoiceId, LocalDateTime.now(timeProperties.zoneId()));
  }

  /**
   * SIFEN HU-06: lets the caller pin the signature timestamp instead of always using "now" — {@code
   * SifenInvoiceSubmissionService} reuses the invoice's first-ever signature timestamp across
   * retries, since AC-07's 72-hour transmission window is measured from that original instant, not
   * from whenever a retry happens to run.
   */
  public SifenSignedDocument signInvoice(
      long tenantId, long invoiceId, LocalDateTime signatureTimestamp) {
    SifenActiveCertificateMaterial material = certificateService.requireActiveCertificate(tenantId);

    SifenInvoiceHeader header = headerService.buildHeader(tenantId, invoiceId);
    SifenInvoiceDetail detail = detailService.buildDetail(tenantId, invoiceId);
    SifenControlNumberFields cdcFields = controlNumberService.parse(header.controlNumber());

    Document unsigned = xmlService.buildDocument(header, detail, cdcFields, signatureTimestamp);
    SifenSignedDocument signed = sign(material, unsigned, signatureTimestamp);

    // SIFEN HU-08: gCamFuFD/dCarQR (the QR code) can only be computed once a signature exists to
    // reference (its hash covers XS17/DigestValue) — appended here, right after signing, as a
    // sibling of <DE>/<Signature>, never nested inside the signed <DE> (see
    // SifenDocumentXmlService#appendQrGroup's javadoc for why that doesn't invalidate the
    // signature). This is also the fix for the schema gap HU-06/HU-07 both left documented:
    // every prior document this system sent SIFEN was rejected for lacking this exact field.
    String digestValueBase64 = extractDigestValueBase64(signed.document());
    SifenQrCodeService.SifenQrResult qr =
        qrCodeService.build(header, detail.totals(), detail.lines().size(), digestValueBase64);
    xmlService.appendQrGroup(signed.document(), qr.qrUrl());
    SifenSignedDocument signedWithQr =
        new SifenSignedDocument(
            signed.document(),
            signed.controlNumber(),
            signed.signedAt(),
            qr.qrUrl(),
            qr.publicConsultationUrl());

    log.info(
        "SIFEN document signed tenantId={} invoiceId={} controlNumber={} certificateId={}",
        tenantId,
        invoiceId,
        signedWithQr.controlNumber(),
        material.certificateId());
    return signedWithQr;
  }

  /** XS17/DigestValue — the signature's own reference digest, needed to compute the QR (HU-08). */
  private static String extractDigestValueBase64(Document signedRDe) {
    NodeList nodes = signedRDe.getElementsByTagNameNS(XMLSignature.XMLNS, "DigestValue");
    if (nodes.getLength() == 0) {
      throw new IllegalStateException("Signed document has no DigestValue to build the QR code");
    }
    return nodes.item(0).getTextContent().trim();
  }

  /**
   * AC-01/AC-03/AC-04: signs the {@code <DE Id="cdc">} element of {@code unsignedRDe} in place,
   * appending {@code <Signature>} as its sibling — the reference's transforms (enveloped +
   * exclusive C14N) cover the entirety of {@code <DE>} and all its subgroups, so any change to that
   * content after signing changes the computed digest and invalidates the signature (AC-03).
   */
  public SifenSignedDocument sign(
      SifenActiveCertificateMaterial material, Document unsignedRDe, LocalDateTime signedAt) {
    Element de = requireDeElement(unsignedRDe);
    String cdc = de.getAttribute("Id");
    signIdentifiedElement(
        material,
        unsignedRDe.getDocumentElement(),
        de,
        "Id",
        cdc,
        CanonicalizationMethod.INCLUSIVE);

    // qrUrl/publicConsultationUrl are only populated by the signInvoice(...) orchestrator (HU-08) —
    // this lower-level sign() step has no header/totals to compute them from.
    return new SifenSignedDocument(unsignedRDe, cdc, signedAt, null, null);
  }

  /**
   * SIFEN HU-10: signs a cancellation (or any future emisor) event's {@code <rEve Id="eventId">}
   * element in place, appending {@code <Signature>} as its sibling inside {@code <rGesEve>} — same
   * enveloped-signature shape as {@link #sign}, just anchored on {@code rEve} instead of {@code DE}
   * (Manual Técnico V150 sección 11.5, GDE008: "Firma Digital del campo rEve"). {@code
   * eventDocument} must be the {@code <rGesEve>}-rooted document {@link
   * SifenCancellationEventXmlService#buildCancellationEvent} produces. AC: the certificate used is
   * always the tenant's own active certificate (HU-21) — never material passed in from elsewhere —
   * mirroring {@link #signInvoice}'s AC-06 guarantee for the DE itself.
   *
   * <p><b>Verified live (2026-07-28) against sifen-test.set.gov.py:</b> unlike {@link #sign} (DE),
   * whose {@code SignedInfo} uses <i>inclusive</i> C14N (confirmed correct by every prior HU-06/07/
   * 08 live check, which came back with real schema-content errors, never a signature error), the
   * events service rejected that same choice for {@code SignedInfo} with {@code dCodRes=0160 "XML
   * mal formado"} — a real, live HTTP 200 from the events endpoint, but with a generic
   * malformed-document code, distinct from the {@code rRetEnviDe}-shaped 400 an entirely missing
   * Signature produces (confirming the request *was* recognized as belonging to the events service,
   * just failing a schema-level check). Cross-checked against a real, publicly maintained competing
   * generator (TIPS-SA's {@code facturacionelectronicapy-xmlsign}, {@code SignXMLEvento.java}):
   * confirms events must use <i>exclusive</i> C14N for {@code SignedInfo} — switching to it here
   * resolved the issue live (see PROGRESS.md for the full before/after response bodies).
   */
  public Document signEvent(long tenantId, Document eventDocument) {
    SifenActiveCertificateMaterial material = certificateService.requireActiveCertificate(tenantId);
    Element rEve = requireREveElement(eventDocument);
    String eventId = rEve.getAttribute("Id");
    signIdentifiedElement(
        material,
        eventDocument.getDocumentElement(),
        rEve,
        "Id",
        eventId,
        CanonicalizationMethod.EXCLUSIVE);

    // Not "cancellation event" — this signs every event type (cancellation, anulación de
    // numeración, receptor events), a real, misleading finding from live diagnosis: the log
    // previously always said "cancellation" here regardless of what was actually being signed.
    log.info(
        "SIFEN event signed tenantId={} eventId={} certificateId={}",
        tenantId,
        eventId,
        material.certificateId());
    return eventDocument;
  }

  /**
   * Shared XML-DSig core for both {@link #sign} (DE) and {@link #signEvent} (event): builds an
   * enveloped signature over {@code elementToSign} (referenced by {@code "#" + idValue}, backed by
   * {@code elementToSign}'s {@code idAttributeName} attribute) and appends {@code <Signature>} as a
   * child of {@code signatureParent} — the document root in both cases ({@code <rDE>} for the DE,
   * {@code <rGesEve>} for an event), so {@code <Signature>} ends up a sibling of the signed
   * element, never nested inside it. {@code signedInfoCanonicalizationMethod} is the one algorithm
   * that differs between DE and event signing — see {@link #signEvent}'s javadoc.
   */
  private static void signIdentifiedElement(
      SifenActiveCertificateMaterial material,
      Element signatureParent,
      Element elementToSign,
      String idAttributeName,
      String idValue,
      String signedInfoCanonicalizationMethod) {
    try {
      XMLSignatureFactory fac = XMLSignatureFactory.getInstance("DOM");

      Reference reference =
          fac.newReference(
              "#" + idValue,
              fac.newDigestMethod(DigestMethod.SHA256, null),
              List.of(
                  fac.newTransform(Transform.ENVELOPED, (TransformParameterSpec) null),
                  fac.newTransform(
                      CanonicalizationMethod.EXCLUSIVE, (TransformParameterSpec) null)),
              null,
              null);

      SignedInfo signedInfo =
          fac.newSignedInfo(
              fac.newCanonicalizationMethod(
                  signedInfoCanonicalizationMethod, (C14NMethodParameterSpec) null),
              fac.newSignatureMethod(SignatureMethod.RSA_SHA256, null),
              List.of(reference));

      KeyInfoFactory kif = fac.getKeyInfoFactory();
      // Only the certificate — the manual forbids X509SubjectName/IssuerSerial/IssuerName/SKI/
      // KeyValue since that information is already implied by the certificate itself.
      X509Data x509Data = kif.newX509Data(List.of(material.certificate()));
      KeyInfo keyInfo = kif.newKeyInfo(List.of(x509Data));

      DOMSignContext signContext = new DOMSignContext(material.privateKey(), signatureParent);
      signContext.setIdAttributeNS(elementToSign, null, idAttributeName);

      XMLSignature signature = fac.newXMLSignature(signedInfo, keyInfo);
      signature.sign(signContext);
    } catch (MarshalException
        | XMLSignatureException
        | NoSuchAlgorithmException
        | InvalidAlgorithmParameterException e) {
      throw new IllegalStateException("Failed to sign SIFEN document id=" + idValue, e);
    }
  }

  /**
   * AC-05: validates a signature using only what's embedded in the document itself — the public key
   * comes from the {@code <X509Certificate>} inside {@code <KeyInfo>} (see {@link
   * DocumentEmbeddedCertificateKeySelector}), not from any external material — so this can verify a
   * document independently of who signed it or which tenant it belongs to, the same way SIFEN or a
   * third party would. Returns {@code false} (never throws) for a missing signature, a tampered
   * document (AC-03), or any other validation failure.
   */
  public boolean verify(Document signedRDe) {
    return verifySignatureOver(signedRDe, requireDeElement(signedRDe));
  }

  /** SIFEN HU-10: same as {@link #verify}, but for a signed cancellation (or future) event. */
  public boolean verifyEvent(Document signedEventDocument) {
    return verifySignatureOver(signedEventDocument, requireREveElement(signedEventDocument));
  }

  private static boolean verifySignatureOver(Document signedDocument, Element signedElement) {
    NodeList signatureNodes =
        signedDocument.getElementsByTagNameNS(XMLSignature.XMLNS, "Signature");
    if (signatureNodes.getLength() == 0) {
      return false;
    }
    Element signatureElement = (Element) signatureNodes.item(0);

    try {
      DOMValidateContext validateContext =
          new DOMValidateContext(new DocumentEmbeddedCertificateKeySelector(), signatureElement);
      validateContext.setIdAttributeNS(signedElement, null, "Id");
      XMLSignatureFactory fac = XMLSignatureFactory.getInstance("DOM");
      XMLSignature signature = fac.unmarshalXMLSignature(validateContext);
      return signature.validate(validateContext);
    } catch (MarshalException | XMLSignatureException e) {
      return false;
    }
  }

  private static Element requireDeElement(Document rDe) {
    NodeList deNodes = rDe.getElementsByTagNameNS(SifenDocumentXmlService.SIFEN_NS, "DE");
    if (deNodes.getLength() == 0) {
      throw new IllegalArgumentException("Document has no <DE> element");
    }
    return (Element) deNodes.item(0);
  }

  private static Element requireREveElement(Document eventDocument) {
    NodeList rEveNodes =
        eventDocument.getElementsByTagNameNS(SifenDocumentXmlService.SIFEN_NS, "rEve");
    if (rEveNodes.getLength() == 0) {
      throw new IllegalArgumentException("Event document has no <rEve> element");
    }
    return (Element) rEveNodes.item(0);
  }

  /** Extracts the public key straight from the signed document's own embedded X.509 certificate. */
  private static final class DocumentEmbeddedCertificateKeySelector extends KeySelector {

    @Override
    public KeySelectorResult select(
        KeyInfo keyInfo,
        KeySelector.Purpose purpose,
        AlgorithmMethod method,
        XMLCryptoContext context)
        throws KeySelectorException {
      for (Object keyInfoContent : keyInfo.getContent()) {
        if (keyInfoContent instanceof X509Data x509Data) {
          for (Object x509Content : x509Data.getContent()) {
            if (x509Content instanceof X509Certificate certificate) {
              PublicKey publicKey = certificate.getPublicKey();
              return () -> publicKey;
            }
          }
        }
      }
      throw new KeySelectorException("No X509Certificate found in KeyInfo");
    }
  }
}
