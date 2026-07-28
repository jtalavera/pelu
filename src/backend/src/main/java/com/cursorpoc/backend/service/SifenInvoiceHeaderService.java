package com.cursorpoc.backend.service;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.config.SifenConnectionProperties;
import com.cursorpoc.backend.domain.BusinessProfile;
import com.cursorpoc.backend.domain.Client;
import com.cursorpoc.backend.domain.FiscalStamp;
import com.cursorpoc.backend.domain.Invoice;
import com.cursorpoc.backend.repository.BusinessProfileRepository;
import com.cursorpoc.backend.repository.InvoiceRepository;
import com.cursorpoc.backend.util.ParaguayRucValidator;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * SIFEN HU-02: completa, para una factura ya emitida, los datos de identificación (CDC de HU-01),
 * timbrado, emisor y receptor que SIFEN exige (sección 10 y grupo D1/D2 del Manual Técnico).
 *
 * <p>Sin endpoint HTTP ni pantalla propia — igual que HU-01/HU-05/HU-21, es una capacidad de
 * servicio consumida por historias futuras (HU-03 agrega el detalle de servicios al documento,
 * HU-04 lo firma). Deliberadamente <b>no</b> se llama desde {@link InvoiceService#issueInvoice} —
 * exigir RUC/actividad económica/tipo de contribuyente completos en cada factura rompería la
 * emisión de cualquier tenant que todavía no use SIFEN (la activación real por tenant es HU-22,
 * Fase 5, que todavía no existe). El único criterio de HU-02 que sí es una regla de negocio
 * universal, no específica de SIFEN, es el umbral de Gs. 7.000.000 (AC-05) — ver la validación en
 * {@link InvoiceService#issueInvoice}, no aquí.
 */
@Service
public class SifenInvoiceHeaderService {

  /** SIFEN C002/iTiDE: Factura Electrónica — el único tipo de documento en alcance de la Fase 1. */
  private static final int FACTURA_ELECTRONICA_DOCUMENT_TYPE = 1;

  /** SIFEN B002/iTipEmi: emisión normal (2 = contingencia, fuera de alcance de la Fase 1). */
  private static final int NORMAL_EMISSION_TYPE = 1;

  /**
   * Literal exigido por el Manual Técnico (validación D105, sección 10) para D105/dNomEmi cuando el
   * documento corre en el ambiente de prueba de SIFEN — reemplaza la razón social real.
   */
  static final String TEST_ENVIRONMENT_ISSUER_NAME_LEGEND =
      "DE generado en ambiente de prueba - sin valor comercial ni fiscal";

  private final InvoiceRepository invoiceRepository;
  private final BusinessProfileRepository businessProfileRepository;
  private final SifenControlNumberService controlNumberService;
  private final SifenConnectionProperties connectionProperties;
  private final FemmeTimeProperties timeProperties;

  public SifenInvoiceHeaderService(
      InvoiceRepository invoiceRepository,
      BusinessProfileRepository businessProfileRepository,
      SifenControlNumberService controlNumberService,
      SifenConnectionProperties connectionProperties,
      FemmeTimeProperties timeProperties) {
    this.invoiceRepository = invoiceRepository;
    this.businessProfileRepository = businessProfileRepository;
    this.controlNumberService = controlNumberService;
    this.connectionProperties = connectionProperties;
    this.timeProperties = timeProperties;
  }

  @Transactional
  public SifenInvoiceHeader buildHeader(long tenantId, long invoiceId) {
    Invoice invoice =
        invoiceRepository
            .findByIdAndTenant_Id(invoiceId, tenantId)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "INVOICE_NOT_FOUND"));
    BusinessProfile profile =
        businessProfileRepository
            .findByTenantId(tenantId)
            .orElseThrow(
                () ->
                    new ResponseStatusException(
                        HttpStatus.PRECONDITION_FAILED, "SIFEN_ISSUER_RUC_INVALID"));
    requireIssuerDataComplete(profile);

    boolean testEnvironment =
        connectionProperties.activeEnvironment() == SifenConnectionProperties.Environment.TEST;

    String controlNumber = resolveControlNumber(invoice, profile, testEnvironment);
    FiscalStamp stamp = invoice.getFiscalStamp();

    return new SifenInvoiceHeader(
        controlNumber,
        stamp.getStampNumber(),
        stamp.getEstablishment(),
        stamp.getExpeditionPoint(),
        buildIssuerData(profile, testEnvironment),
        buildReceiverData(invoice),
        testEnvironment);
  }

  /**
   * AC-01/AC-06 (HU-01): genera el CDC una sola vez por factura y lo persiste junto con el código
   * de seguridad, para que reconstruir el documento más adelante (p.ej. antes de HU-06) sea
   * determinista.
   */
  private String resolveControlNumber(
      Invoice invoice, BusinessProfile profile, boolean testEnvironment) {
    if (invoice.getSifenControlNumber() != null) {
      return invoice.getSifenControlNumber();
    }
    String securityCode = invoice.getSifenSecurityCode();
    if (securityCode == null) {
      securityCode = controlNumberService.generateSecurityCode(invoice.getInvoiceNumber());
      invoice.setSifenSecurityCode(securityCode);
    }

    ParaguayRucValidator.RucParts rucParts = ParaguayRucValidator.split(profile.getRuc());
    FiscalStamp stamp = invoice.getFiscalStamp();
    SifenControlNumberFields fields =
        new SifenControlNumberFields(
            FACTURA_ELECTRONICA_DOCUMENT_TYPE,
            rucParts.base(),
            rucParts.checkDigit(),
            stamp.getEstablishment(),
            stamp.getExpeditionPoint(),
            invoice.getInvoiceNumber(),
            profile.getTaxpayerType().sifenCode(),
            invoice.getIssuedAt().atZone(timeProperties.zoneId()).toLocalDate(),
            NORMAL_EMISSION_TYPE,
            securityCode);
    String controlNumber = controlNumberService.build(fields);
    invoice.setSifenControlNumber(controlNumber);
    return controlNumber;
  }

  /** AC-03: datos del emisor; AC-08: leyenda de ambiente de prueba en vez de la razón social. */
  private SifenIssuerData buildIssuerData(BusinessProfile profile, boolean testEnvironment) {
    ParaguayRucValidator.RucParts rucParts = ParaguayRucValidator.split(profile.getRuc());
    String businessName =
        testEnvironment ? TEST_ENVIRONMENT_ISSUER_NAME_LEGEND : profile.getBusinessName();
    return new SifenIssuerData(
        rucParts.base(),
        rucParts.checkDigit(),
        businessName,
        profile.getAddress(),
        profile.getTaxpayerType(),
        profile.getEconomicActivityCode(),
        profile.getEconomicActivityDescription());
  }

  /**
   * AC-04: consumidor final sin RUC no exige datos de identificación — todos los campos quedan en
   * {@code null} salvo, si se informó, el nombre para mostrar. AC-06: RUC + nombre cuando el
   * cliente tiene RUC. AC-07: departamento y ciudad solo si se informó una dirección.
   */
  private SifenReceiverData buildReceiverData(Invoice invoice) {
    Client client = invoice.getClient();
    String ruc =
        invoice.getClientRucOverride() != null
            ? invoice.getClientRucOverride()
            : (client != null ? client.getRuc() : null);
    String identityDocument =
        invoice.getClientIdentityDocumentOverride() != null
            ? invoice.getClientIdentityDocumentOverride()
            : (client != null ? client.getIdentityDocumentNumber() : null);
    String address = client != null ? client.getAddress() : null;
    boolean hasAddress = address != null && !address.isBlank();
    return new SifenReceiverData(
        ruc,
        identityDocument,
        invoice.getClientDisplayName(),
        address,
        hasAddress && client != null ? client.getDepartment() : null,
        hasAddress && client != null ? client.getCity() : null);
  }

  private static void requireIssuerDataComplete(BusinessProfile profile) {
    if (profile.getRuc() == null || !ParaguayRucValidator.isValid(profile.getRuc())) {
      throw new ResponseStatusException(HttpStatus.PRECONDITION_FAILED, "SIFEN_ISSUER_RUC_INVALID");
    }
    if (profile.getAddress() == null || profile.getAddress().isBlank()) {
      throw new ResponseStatusException(
          HttpStatus.PRECONDITION_FAILED, "SIFEN_ISSUER_ADDRESS_MISSING");
    }
    if (profile.getTaxpayerType() == null) {
      throw new ResponseStatusException(
          HttpStatus.PRECONDITION_FAILED, "SIFEN_TAXPAYER_TYPE_NOT_CONFIGURED");
    }
    if (isBlank(profile.getEconomicActivityCode())
        || isBlank(profile.getEconomicActivityDescription())) {
      throw new ResponseStatusException(
          HttpStatus.PRECONDITION_FAILED, "SIFEN_ECONOMIC_ACTIVITY_NOT_CONFIGURED");
    }
  }

  private static boolean isBlank(String s) {
    return s == null || s.isBlank();
  }
}
