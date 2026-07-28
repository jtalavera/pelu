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
  private final FemmeTimeProperties timeProperties;

  public SifenDocumentSigningService(
      SifenCertificateService certificateService,
      SifenInvoiceHeaderService headerService,
      SifenInvoiceDetailService detailService,
      SifenControlNumberService controlNumberService,
      SifenDocumentXmlService xmlService,
      FemmeTimeProperties timeProperties) {
    this.certificateService = certificateService;
    this.headerService = headerService;
    this.detailService = detailService;
    this.controlNumberService = controlNumberService;
    this.xmlService = xmlService;
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
    SifenActiveCertificateMaterial material = certificateService.requireActiveCertificate(tenantId);

    SifenInvoiceHeader header = headerService.buildHeader(tenantId, invoiceId);
    SifenInvoiceDetail detail = detailService.buildDetail(tenantId, invoiceId);
    SifenControlNumberFields cdcFields = controlNumberService.parse(header.controlNumber());
    LocalDateTime signatureTimestamp = LocalDateTime.now(timeProperties.zoneId());

    Document unsigned = xmlService.buildDocument(header, detail, cdcFields, signatureTimestamp);
    SifenSignedDocument signed = sign(material, unsigned, signatureTimestamp);
    log.info(
        "SIFEN document signed tenantId={} invoiceId={} controlNumber={} certificateId={}",
        tenantId,
        invoiceId,
        signed.controlNumber(),
        material.certificateId());
    return signed;
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
    Element rDE = unsignedRDe.getDocumentElement();

    try {
      XMLSignatureFactory fac = XMLSignatureFactory.getInstance("DOM");

      Reference reference =
          fac.newReference(
              "#" + cdc,
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
                  CanonicalizationMethod.INCLUSIVE, (C14NMethodParameterSpec) null),
              fac.newSignatureMethod(SignatureMethod.RSA_SHA256, null),
              List.of(reference));

      KeyInfoFactory kif = fac.getKeyInfoFactory();
      // Only the certificate — the manual forbids X509SubjectName/IssuerSerial/IssuerName/SKI/
      // KeyValue since that information is already implied by the certificate itself.
      X509Data x509Data = kif.newX509Data(List.of(material.certificate()));
      KeyInfo keyInfo = kif.newKeyInfo(List.of(x509Data));

      DOMSignContext signContext = new DOMSignContext(material.privateKey(), rDE);
      signContext.setIdAttributeNS(de, null, "Id");

      XMLSignature signature = fac.newXMLSignature(signedInfo, keyInfo);
      signature.sign(signContext);
    } catch (MarshalException
        | XMLSignatureException
        | NoSuchAlgorithmException
        | InvalidAlgorithmParameterException e) {
      throw new IllegalStateException("Failed to sign SIFEN document controlNumber=" + cdc, e);
    }

    return new SifenSignedDocument(unsignedRDe, cdc, signedAt);
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
    Element de = requireDeElement(signedRDe);
    NodeList signatureNodes = signedRDe.getElementsByTagNameNS(XMLSignature.XMLNS, "Signature");
    if (signatureNodes.getLength() == 0) {
      return false;
    }
    Element signatureElement = (Element) signatureNodes.item(0);

    try {
      DOMValidateContext validateContext =
          new DOMValidateContext(new DocumentEmbeddedCertificateKeySelector(), signatureElement);
      validateContext.setIdAttributeNS(de, null, "Id");
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
