package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.config.SifenConnectionProperties;
import com.cursorpoc.backend.domain.BusinessProfile;
import com.cursorpoc.backend.domain.Client;
import com.cursorpoc.backend.domain.FiscalStamp;
import com.cursorpoc.backend.domain.Invoice;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.enums.SifenTaxpayerType;
import com.cursorpoc.backend.repository.BusinessProfileRepository;
import com.cursorpoc.backend.repository.InvoiceRepository;
import java.time.Instant;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.web.server.ResponseStatusException;

@ExtendWith(MockitoExtension.class)
class SifenInvoiceHeaderServiceTest {

  private static final long TENANT_ID = 1L;
  private static final long INVOICE_ID = 100L;

  @Mock private InvoiceRepository invoiceRepository;
  @Mock private BusinessProfileRepository businessProfileRepository;

  private SifenInvoiceHeaderService service;
  private Invoice invoice;
  private BusinessProfile profile;
  private FiscalStamp stamp;

  @BeforeEach
  void setUp() {
    SifenConnectionProperties connectionProperties = new SifenConnectionProperties();
    connectionProperties.setEnvironment(SifenConnectionProperties.Environment.TEST);
    service =
        new SifenInvoiceHeaderService(
            invoiceRepository,
            businessProfileRepository,
            new SifenControlNumberService(),
            connectionProperties,
            new FemmeTimeProperties());

    Tenant tenant = new Tenant();
    tenant.setId(TENANT_ID);

    stamp = new FiscalStamp();
    stamp.setTenant(tenant);
    stamp.setStampNumber("1137152");
    stamp.setEstablishment(1);
    stamp.setExpeditionPoint(2);

    profile = new BusinessProfile();
    profile.setTenant(tenant);
    profile.setBusinessName("Lucía Zymanscki de Onieva Vit S.A.");
    profile.setRuc("1137152-8");
    profile.setAddress("Avda. España 123");
    profile.setTaxpayerType(SifenTaxpayerType.LEGAL_ENTITY);
    profile.setEconomicActivityCode("96020");
    profile.setEconomicActivityDescription("Peluquería y otros tratamientos de belleza");

    invoice = new Invoice();
    invoice.setId(INVOICE_ID);
    invoice.setTenant(tenant);
    invoice.setFiscalStamp(stamp);
    invoice.setInvoiceNumber(14528);
    invoice.setIssuedAt(Instant.parse("2026-07-28T15:00:00Z"));

    when(invoiceRepository.findByIdAndTenant_Id(INVOICE_ID, TENANT_ID))
        .thenReturn(Optional.of(invoice));
    when(businessProfileRepository.findByTenantId(TENANT_ID)).thenReturn(Optional.of(profile));
  }

  /** AC-01: the header includes HU-01's 44-character control number. */
  @Test
  void buildHeader_includesA44CharacterControlNumber() {
    SifenInvoiceHeader header = service.buildHeader(TENANT_ID, INVOICE_ID);

    assertThat(header.controlNumber()).hasSize(44);
    assertThat(new SifenControlNumberService().isValid(header.controlNumber())).isTrue();
  }

  /** AC-02: timbrado, establecimiento y punto de expedición vigentes. */
  @Test
  void buildHeader_includesStampEstablishmentAndExpeditionPoint() {
    SifenInvoiceHeader header = service.buildHeader(TENANT_ID, INVOICE_ID);

    assertThat(header.stampNumber()).isEqualTo("1137152");
    assertThat(header.establishment()).isEqualTo(1);
    assertThat(header.expeditionPoint()).isEqualTo(2);
  }

  /** AC-03: RUC, razón social, dirección y actividad económica del emisor. */
  @Test
  void buildHeader_includesIssuerDataFromBusinessProfile() {
    SifenInvoiceHeader header = service.buildHeader(TENANT_ID, INVOICE_ID);

    SifenIssuerData issuer = header.issuer();
    assertThat(issuer.ruc()).isEqualTo("1137152");
    assertThat(issuer.rucCheckDigit()).isEqualTo(8);
    assertThat(issuer.address()).isEqualTo("Avda. España 123");
    assertThat(issuer.taxpayerType()).isEqualTo(SifenTaxpayerType.LEGAL_ENTITY);
    assertThat(issuer.economicActivityCode()).isEqualTo("96020");
    assertThat(issuer.economicActivityDescription())
        .isEqualTo("Peluquería y otros tratamientos de belleza");
  }

  /** AC-04: consumidor final sin RUC no exige datos de identificación. */
  @Test
  void buildHeader_consumidorFinalWithoutRuc_doesNotRequireIdentification() {
    invoice.setClientDisplayName("CONSUMIDOR FINAL");

    SifenInvoiceHeader header = service.buildHeader(TENANT_ID, INVOICE_ID);

    assertThat(header.receiver().ruc()).isNull();
    assertThat(header.receiver().identityDocumentNumber()).isNull();
    assertThat(header.receiver().name()).isEqualTo("CONSUMIDOR FINAL");
  }

  /** AC-06: si el cliente tiene RUC, se incluyen su RUC y nombre. */
  @Test
  void buildHeader_clientWithRuc_includesRucAndName() {
    Client client = new Client();
    client.setRuc("80000005-6");
    invoice.setClient(client);
    invoice.setClientDisplayName("Cliente Demo");

    SifenInvoiceHeader header = service.buildHeader(TENANT_ID, INVOICE_ID);

    assertThat(header.receiver().ruc()).isEqualTo("80000005-6");
    assertThat(header.receiver().name()).isEqualTo("Cliente Demo");
  }

  /** AC-05 (walk-in path): an occasional client identified by cédula, not RUC, is also accepted. */
  @Test
  void buildHeader_occasionalClientWithIdentityDocumentOverride_isIncluded() {
    invoice.setClientIdentityDocumentOverride("4123456");

    SifenInvoiceHeader header = service.buildHeader(TENANT_ID, INVOICE_ID);

    assertThat(header.receiver().identityDocumentNumber()).isEqualTo("4123456");
    assertThat(header.receiver().ruc()).isNull();
  }

  /** AC-07: si se informa la dirección del cliente, se incluyen su departamento y ciudad. */
  @Test
  void buildHeader_clientWithAddress_includesDepartmentAndCity() {
    Client client = new Client();
    client.setAddress("Mcal. López 456");
    client.setDepartment("Central");
    client.setCity("Fernando de la Mora");
    invoice.setClient(client);

    SifenInvoiceHeader header = service.buildHeader(TENANT_ID, INVOICE_ID);

    assertThat(header.receiver().address()).isEqualTo("Mcal. López 456");
    assertThat(header.receiver().department()).isEqualTo("Central");
    assertThat(header.receiver().city()).isEqualTo("Fernando de la Mora");
  }

  /** AC-07 (negative): without an address, departamento/ciudad are not fabricated. */
  @Test
  void buildHeader_clientWithoutAddress_doesNotIncludeDepartmentOrCity() {
    Client client = new Client();
    client.setDepartment("Central");
    client.setCity("Fernando de la Mora");
    invoice.setClient(client);

    SifenInvoiceHeader header = service.buildHeader(TENANT_ID, INVOICE_ID);

    assertThat(header.receiver().address()).isNull();
    assertThat(header.receiver().department()).isNull();
    assertThat(header.receiver().city()).isNull();
  }

  /** AC-08: en ambiente de prueba, la razón social se reemplaza por la leyenda obligatoria. */
  @Test
  void buildHeader_testEnvironment_replacesBusinessNameWithLegend() {
    SifenInvoiceHeader header = service.buildHeader(TENANT_ID, INVOICE_ID);

    assertThat(header.testEnvironmentNotice()).isTrue();
    assertThat(header.issuer().businessName())
        .isEqualTo(SifenInvoiceHeaderService.TEST_ENVIRONMENT_ISSUER_NAME_LEGEND);
  }

  /** AC-08 (contrast): in production, the real business name is used, not the test legend. */
  @Test
  void buildHeader_productionEnvironment_usesRealBusinessName() {
    SifenConnectionProperties productionProperties = new SifenConnectionProperties();
    productionProperties.setEnvironment(SifenConnectionProperties.Environment.PRODUCTION);
    SifenInvoiceHeaderService prodService =
        new SifenInvoiceHeaderService(
            invoiceRepository,
            businessProfileRepository,
            new SifenControlNumberService(),
            productionProperties,
            new FemmeTimeProperties());

    SifenInvoiceHeader header = prodService.buildHeader(TENANT_ID, INVOICE_ID);

    assertThat(header.testEnvironmentNotice()).isFalse();
    assertThat(header.issuer().businessName()).isEqualTo("Lucía Zymanscki de Onieva Vit S.A.");
  }

  /** HU-01 AC-06: rebuilding the header for the same invoice reuses the same control number. */
  @Test
  void buildHeader_isDeterministicAcrossCalls() {
    SifenInvoiceHeader first = service.buildHeader(TENANT_ID, INVOICE_ID);
    SifenInvoiceHeader second = service.buildHeader(TENANT_ID, INVOICE_ID);

    assertThat(second.controlNumber()).isEqualTo(first.controlNumber());
    assertThat(invoice.getSifenControlNumber()).isEqualTo(first.controlNumber());
  }

  @Test
  void buildHeader_throwsWhenTaxpayerTypeNotConfigured() {
    profile.setTaxpayerType(null);

    assertThatThrownBy(() -> service.buildHeader(TENANT_ID, INVOICE_ID))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("SIFEN_TAXPAYER_TYPE_NOT_CONFIGURED");
  }

  @Test
  void buildHeader_throwsWhenEconomicActivityNotConfigured() {
    profile.setEconomicActivityCode(null);

    assertThatThrownBy(() -> service.buildHeader(TENANT_ID, INVOICE_ID))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("SIFEN_ECONOMIC_ACTIVITY_NOT_CONFIGURED");
  }

  @Test
  void buildHeader_throwsWhenIssuerRucIsInvalid() {
    profile.setRuc("not-a-ruc-!!");

    assertThatThrownBy(() -> service.buildHeader(TENANT_ID, INVOICE_ID))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("SIFEN_ISSUER_RUC_INVALID");
  }
}
