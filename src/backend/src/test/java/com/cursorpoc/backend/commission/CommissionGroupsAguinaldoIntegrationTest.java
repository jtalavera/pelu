package com.cursorpoc.backend.commission;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.cursorpoc.backend.domain.CommissionEntry;
import com.cursorpoc.backend.domain.CommissionSettlement;
import com.cursorpoc.backend.domain.Invoice;
import com.cursorpoc.backend.domain.InvoiceLine;
import com.cursorpoc.backend.domain.Professional;
import com.cursorpoc.backend.domain.SalonService;
import com.cursorpoc.backend.domain.ServiceCategory;
import com.cursorpoc.backend.domain.Tax;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.Tier;
import com.cursorpoc.backend.domain.enums.CommissionRuleOrigin;
import com.cursorpoc.backend.domain.enums.ServiceKind;
import com.cursorpoc.backend.repository.CommissionEntryRepository;
import com.cursorpoc.backend.repository.ProfessionalRepository;
import com.cursorpoc.backend.repository.SalonServiceRepository;
import com.cursorpoc.backend.repository.ServiceCategoryRepository;
import com.cursorpoc.backend.repository.TaxRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.repository.TierRepository;
import com.cursorpoc.backend.web.dto.CommissionDtos.AguinaldoAdjustmentRequest;
import com.cursorpoc.backend.web.dto.CommissionDtos.AguinaldoBulkPaymentRequest;
import com.cursorpoc.backend.web.dto.CommissionDtos.AguinaldoPaymentRequest;
import com.cursorpoc.backend.web.dto.CommissionDtos.ApplyChangesRequest;
import com.cursorpoc.backend.web.dto.CommissionDtos.ConfigChange;
import com.cursorpoc.backend.web.dto.CommissionDtos.GenerateSettlementsRequest;
import com.cursorpoc.backend.web.dto.CommissionDtos.GroupAssignment;
import com.cursorpoc.backend.web.dto.CommissionDtos.GroupView;
import com.cursorpoc.backend.web.dto.CommissionDtos.PayRequest;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * HU-COM-14 against the real JPA mapping (H2): rules by professional + group with aguinaldo
 * retention and fixed amounts, the groups API and the aguinaldo fund. Each test has its own tenant.
 */
@SpringBootTest
@ActiveProfiles("test")
class CommissionGroupsAguinaldoIntegrationTest {

  private static final AtomicLong IDS = new AtomicLong(950_000);

  @Autowired private TenantRepository tenantRepository;
  @Autowired private TierRepository tierRepository;
  @Autowired private ProfessionalRepository professionalRepository;
  @Autowired private ServiceCategoryRepository categoryRepository;
  @Autowired private SalonServiceRepository serviceRepository;
  @Autowired private TaxRepository taxRepository;
  @Autowired private CommissionEntryRepository entryRepository;
  @Autowired private CommissionConfigService configService;
  @Autowired private CommissionGroupService groupService;
  @Autowired private CommissionSettlementService settlementService;
  @Autowired private CommissionAccrualService accrualService;
  @Autowired private AguinaldoService aguinaldoService;
  @Autowired private CommissionOverviewService overviewService;
  @Autowired private CommissionQueryService queryService;
  @Autowired private PlatformTransactionManager transactionManager;

  private TransactionTemplate tx;
  private Tenant tenant;
  private Professional gaby;
  private Professional jorgelina;
  private SalonService brushingLargo;
  private SalonService pestanas;
  private SalonService banoDeCrema;
  private Tax iva;
  private long brushingGroup;
  private long lashesGroup;

  @BeforeEach
  void setUp() {
    tx = new TransactionTemplate(transactionManager);
    Tier tier = new Tier();
    tier.setName("tier " + System.nanoTime());
    tier = tierRepository.save(tier);
    Tenant t = new Tenant();
    t.setName("Salon " + System.nanoTime());
    t.setTier(tier);
    tenant = tenantRepository.save(t);
    gaby = professional("Gaby");
    jorgelina = professional("Jorgelina");
    iva = new Tax();
    iva.setTenant(tenant);
    iva.setName("IVA 10");
    iva.setRate(BigDecimal.TEN);
    iva.setActive(true);
    iva = taxRepository.save(iva);
    brushingLargo = item("Brushing pelo largo");
    pestanas = item("Pestañas pelo a pelo");
    banoDeCrema = item("Baño de crema");
    brushingGroup = groupService.create(tenant.getId(), "Brushing").id();
    lashesGroup = groupService.create(tenant.getId(), "Pestañas").id();
    groupService.assign(
        tenant.getId(),
        List.of(
            new GroupAssignment(brushingLargo.getId(), brushingGroup),
            new GroupAssignment(pestanas.getId(), lashesGroup)));
  }

  private Professional professional(String name) {
    Professional p = new Professional();
    p.setTenant(tenant);
    p.setFullName(name);
    p.setActive(true);
    return professionalRepository.save(p);
  }

  private SalonService item(String name) {
    ServiceCategory c = new ServiceCategory();
    c.setTenant(tenant);
    c.setName(name + " cat " + System.nanoTime());
    c.setActive(true);
    c.setKind(ServiceKind.SERVICE);
    c = categoryRepository.save(c);
    SalonService s = new SalonService();
    s.setTenant(tenant);
    s.setCategory(c);
    s.setName(name);
    s.setPriceMinor(BigDecimal.valueOf(100_000));
    s.setDurationMinutes(30);
    s.setActive(true);
    s.setKind(ServiceKind.SERVICE);
    s.setTax(iva);
    return serviceRepository.save(s);
  }

  private Invoice invoice(SalonService service, Professional pro, String total) {
    Invoice inv = new Invoice();
    inv.setId(IDS.incrementAndGet());
    inv.setTenant(tenant);
    inv.setInvoiceNumber((int) (IDS.get() % 1_000_000));
    inv.setIssuedAt(Instant.now());
    InvoiceLine l = new InvoiceLine();
    l.setId(IDS.incrementAndGet());
    l.setInvoice(inv);
    l.setSalonService(service);
    l.setProfessional(pro);
    BigDecimal t = new BigDecimal(total);
    l.setDescription(service.getName());
    l.setQuantity(1);
    l.setUnitPrice(t);
    l.setLineTotal(t);
    l.setTaxRate(BigDecimal.TEN);
    l.setTaxAmount(CommissionCalculator.includedTax(t, BigDecimal.TEN));
    inv.getLines().add(l);
    return inv;
  }

  private void accrue(Invoice inv) {
    tx.executeWithoutResult(s -> accrualService.accrue(inv));
  }

  private void change(String mode, ConfigChange... changes) {
    configService.applyChanges(
        tenant.getId(),
        "admin@test",
        new ApplyChangesRequest(List.of(changes), mode, false, false));
  }

  private ConfigChange groupRule(long groupId, Professional p, String value) {
    return new ConfigChange("GROUP_RULE", null, p == null ? null : p.getId(), groupId, value, null);
  }

  private void configureSalon() {
    change(
        "IMMEDIATE",
        new ConfigChange("BASE", null, null, "TAX_INCLUDED", null),
        new ConfigChange("AGUINALDO_ENABLED", null, null, "true", null),
        // HU-COM-20: the % of a group is the whole commission for everybody; Gaby retains 5 % of
        // it.
        new ConfigChange("RETENTION_PROFILE", null, gaby.getId(), null, "5", null),
        groupRule(brushingGroup, null, "50"),
        groupRule(lashesGroup, null, "50|0|20000|P"));
  }

  private List<CommissionEntry> entries() {
    return entryRepository.findForReport(
        tenant.getId(), Instant.EPOCH, Instant.now().plusSeconds(3600), null);
  }

  /** Accrues two lines for Gaby, settles and approves them: retention 5.000 + 1.500 = 6.500. */
  private CommissionSettlement settledGaby() {
    accrue(invoice(brushingLargo, gaby, "100000"));
    accrue(invoice(pestanas, gaby, "50000"));
    LocalDate today = LocalDate.now(configService.zone());
    CommissionSettlement s =
        settlementService
            .generate(
                tenant.getId(),
                "admin@test",
                new GenerateSettlementsRequest(today, today, List.of(gaby.getId())))
            .get(0);
    return settlementService.approve(tenant.getId(), s.getId(), "admin@test");
  }

  @Test
  void assigningReturnsEachAffectedItemAsTheListShowsItNow() {
    // Baño de crema has no group yet; assigning it and taking Brushing out of its group in one go.
    var result =
        groupService.assignWithRows(
            tenant.getId(),
            List.of(
                new GroupAssignment(banoDeCrema.getId(), brushingGroup),
                new GroupAssignment(brushingLargo.getId(), null)));

    assertThat(result.changed()).isEqualTo(2);
    var assigned =
        result.rows().stream().filter(r -> r.serviceId().equals(banoDeCrema.getId())).findFirst();
    assertThat(assigned).isPresent();
    assertThat(assigned.get().groupId()).isEqualTo(brushingGroup);
    assertThat(assigned.get().groupName()).isEqualTo("Brushing");
    assertThat(assigned.get().suggestion()).isNull();
    // The one taken out of its group is ungrouped again, with the suggestion its name gives.
    var removed =
        result.rows().stream().filter(r -> r.serviceId().equals(brushingLargo.getId())).findFirst();
    assertThat(removed).isPresent();
    assertThat(removed.get().groupId()).isNull();
    assertThat(removed.get().suggestion()).isNotNull();
    assertThat(removed.get().suggestion().groupName()).isEqualTo("Brushing");
  }

  @Test
  void assigningToAnUnknownGroupOrItemIsRefusedWithItsCode() {
    org.assertj.core.api.Assertions.assertThatThrownBy(
            () ->
                groupService.assignWithRows(
                    tenant.getId(), List.of(new GroupAssignment(banoDeCrema.getId(), 999_999L))))
        .hasMessageContaining("COMMISSION_GROUP_NOT_FOUND");
    org.assertj.core.api.Assertions.assertThatThrownBy(
            () ->
                groupService.assignWithRows(
                    tenant.getId(), List.of(new GroupAssignment(999_999L, brushingGroup))))
        .hasMessageContaining("SERVICE_NOT_FOUND");
  }

  @Test
  void aGroupRuleAccruesTheSplitAndKeepsASnapshot() {
    configureSalon();
    accrue(invoice(brushingLargo, gaby, "100000"));
    accrue(invoice(pestanas, gaby, "50000"));
    accrue(invoice(brushingLargo, jorgelina, "100000"));

    List<CommissionEntry> es = entries();
    assertThat(es).hasSize(3);
    CommissionEntry brushing = es.get(0);
    assertThat(brushing.getRuleOrigin()).isEqualTo(CommissionRuleOrigin.GROUP);
    assertThat(brushing.getCommissionAmount()).isEqualByComparingTo("45000");
    assertThat(brushing.getRetentionAmount()).isEqualByComparingTo("5000");
    assertThat(brushing.getRetentionPercent()).isEqualByComparingTo("5");
    CommissionEntry lashes = es.get(1);
    assertThat(lashes.getBaseAmount()).isEqualByComparingTo("30000");
    assertThat(lashes.getFixedAmount()).isEqualByComparingTo("20000");
    assertThat(lashes.isFixedToProfessional()).isTrue();
    assertThat(lashes.getCommissionAmount()).isEqualByComparingTo("33500");
    assertThat(lashes.getRetentionAmount()).isEqualByComparingTo("1500");
    CommissionEntry jorge = es.get(2);
    assertThat(jorge.getCommissionAmount()).isEqualByComparingTo("50000");
    assertThat(jorge.getRetentionAmount()).isEqualByComparingTo("0");
  }

  @Test
  void aSettlementTotalsWhatIsPaidAndTheFundGrowsWhenItIsApproved() {
    configureSalon();
    accrue(invoice(brushingLargo, gaby, "100000"));
    accrue(invoice(pestanas, gaby, "50000"));
    LocalDate today = LocalDate.now(configService.zone());
    CommissionSettlement s =
        settlementService
            .generate(
                tenant.getId(),
                "admin@test",
                new GenerateSettlementsRequest(today, today, List.of(gaby.getId())))
            .get(0);
    assertThat(s.getTotalAmount()).isEqualByComparingTo("78500"); // 45.000 + 33.500
    // A draft does not feed the fund yet.
    assertThat(aguinaldoService.balanceOf(tenant.getId(), gaby.getId())).isEqualByComparingTo("0");
    settlementService.approve(tenant.getId(), s.getId(), "admin@test");
    assertThat(aguinaldoService.balanceOf(tenant.getId(), gaby.getId()))
        .isEqualByComparingTo("6500");
  }

  @Test
  void voidingAnApprovedSettlementTakesTheRetentionBackOutOfTheFund() {
    configureSalon();
    CommissionSettlement s = settledGaby();
    assertThat(aguinaldoService.balanceOf(tenant.getId(), gaby.getId()))
        .isEqualByComparingTo("6500");
    settlementService.voidSettlement(tenant.getId(), s.getId(), "admin@test", "error");
    assertThat(aguinaldoService.balanceOf(tenant.getId(), gaby.getId())).isEqualByComparingTo("0");
  }

  @Test
  void theFundIsPaidInPartsInFullAndOnDeparture() {
    configureSalon();
    settledGaby();
    long tenantId = tenant.getId();
    var detail = aguinaldoService.detail(tenantId, gaby.getId());
    assertThat(detail.balance()).isEqualByComparingTo("6500");
    assertThat(detail.movements()).hasSize(1);
    assertThat(detail.movements().get(0).kind()).isEqualTo("ACCRUAL");

    aguinaldoService.pay(
        tenantId,
        "admin@test",
        new AguinaldoPaymentRequest(
            gaby.getId(), new BigDecimal("2500"), null, "CASH", false, null));
    assertThat(aguinaldoService.balanceOf(tenantId, gaby.getId())).isEqualByComparingTo("4000");

    assertThatThrownBy(
            () ->
                aguinaldoService.pay(
                    tenantId,
                    "admin@test",
                    new AguinaldoPaymentRequest(
                        gaby.getId(), new BigDecimal("4001"), null, "CASH", false, null)))
        .hasMessageContaining("AGUINALDO_AMOUNT_EXCEEDS_BALANCE");
    assertThatThrownBy(
            () ->
                aguinaldoService.pay(
                    tenantId,
                    "admin@test",
                    new AguinaldoPaymentRequest(
                        gaby.getId(), new BigDecimal("100"), null, "BITCOIN", false, null)))
        .hasMessageContaining("AGUINALDO_PAYMENT_METHOD_INVALID");

    aguinaldoService.adjust(
        tenantId,
        "admin@test",
        new AguinaldoAdjustmentRequest(gaby.getId(), new BigDecimal("-500"), "factura anulada"));
    assertThat(aguinaldoService.balanceOf(tenantId, gaby.getId())).isEqualByComparingTo("3500");
    assertThatThrownBy(
            () ->
                aguinaldoService.adjust(
                    tenantId,
                    "admin@test",
                    new AguinaldoAdjustmentRequest(gaby.getId(), new BigDecimal("-9999"), "x")))
        .hasMessageContaining("AGUINALDO_BALANCE_NEGATIVE");

    // Departure: pays the whole balance whatever amount is asked.
    aguinaldoService.pay(
        tenantId,
        "admin@test",
        new AguinaldoPaymentRequest(
            gaby.getId(), new BigDecimal("1"), null, "TRANSFER", true, null));
    assertThat(aguinaldoService.balanceOf(tenantId, gaby.getId())).isEqualByComparingTo("0");
    assertThatThrownBy(
            () ->
                aguinaldoService.pay(
                    tenantId,
                    "admin@test",
                    new AguinaldoPaymentRequest(gaby.getId(), null, null, "CASH", false, null)))
        .hasMessageContaining("AGUINALDO_NOTHING_TO_PAY");

    var after = aguinaldoService.detail(tenantId, gaby.getId());
    assertThat(after.movements())
        .extracting(m -> m.kind())
        .contains("ACCRUAL", "PAYMENT", "ADJUSTMENT");
    assertThat(after.movements().get(0).balance()).isEqualByComparingTo("0"); // newest first
  }

  @Test
  void payAllPaysEveryBalanceAndSummaryListsThem() {
    configureSalon();
    settledGaby();
    var summary = aguinaldoService.summary(tenant.getId());
    assertThat(summary.enabled()).isTrue();
    assertThat(summary.totalBalance()).isEqualByComparingTo("6500");
    assertThat(summary.balances()).hasSize(1);
    assertThat(summary.balances().get(0).professionalName()).isEqualTo("Gaby");

    int paid =
        aguinaldoService.payAll(
            tenant.getId(),
            "admin@test",
            new AguinaldoBulkPaymentRequest(null, "CASH", "Aguinaldo diciembre"));
    assertThat(paid).isEqualTo(1);
    var after = aguinaldoService.summary(tenant.getId());
    assertThat(after.totalBalance()).isEqualByComparingTo("0");
    assertThat(after.balances().get(0).paid()).isEqualByComparingTo("6500");
    assertThat(after.balances().get(0).lastPaymentOn()).isNotNull();
  }

  @Test
  void theRuleOfTheProfessionalForAServiceBeatsTheGroup() {
    configureSalon();
    change("IMMEDIATE", new ConfigChange("RULE", brushingLargo.getId(), gaby.getId(), "60", null));
    accrue(invoice(brushingLargo, gaby, "100000"));
    CommissionEntry e = entries().get(0);
    assertThat(e.getRuleOrigin()).isEqualTo(CommissionRuleOrigin.BENEFICIARY_ITEM);
    // 60 % is her whole commission; she retains 5 % of the base out of it.
    assertThat(e.getCommissionAmount()).isEqualByComparingTo("55000");
    assertThat(e.getRetentionAmount()).isEqualByComparingTo("5000");
  }

  @Test
  void changingTheRetentionOfAProfessionalRecalculatesWhatIsStillOpen() {
    configureSalon();
    accrue(invoice(brushingLargo, jorgelina, "100000")); // 50 %, no retention yet
    assertThat(entries().get(0).getCommissionAmount()).isEqualByComparingTo("50000");
    // The retention is not a harmless default any more: it asks how to apply and it recalculates.
    change(
        "PERIOD_START",
        new ConfigChange("RETENTION_PROFILE", null, jorgelina.getId(), null, "5", null));
    // The old entry is reversed and a new revision is written: the net is what counts.
    List<CommissionEntry> all = entries();
    assertThat(
            all.stream()
                .map(CommissionEntry::getCommissionAmount)
                .reduce(BigDecimal.ZERO, BigDecimal::add))
        .isEqualByComparingTo("45000");
    assertThat(
            all.stream()
                .map(CommissionEntry::getRetentionAmount)
                .reduce(BigDecimal.ZERO, BigDecimal::add))
        .isEqualByComparingTo("5000");
  }

  @Test
  void aRecalculatedLineIsOneSaleNotTwoOrThree() {
    configureSalon();
    accrue(invoice(brushingLargo, jorgelina, "100000")); // one invoice, one line
    change(
        "PERIOD_START",
        new ConfigChange("RETENTION_PROFILE", null, jorgelina.getId(), null, "5", null));
    // Behind the amount there are three rows (the commission, its reversal and the new
    // commission)...
    assertThat(entries()).hasSize(3);
    // ...but it is still one invoiced line, in the summary card and in the settle list.
    var preview = queryService.settlementPreview(tenant.getId(), jorgelina.getId(), null, null);
    assertThat(preview.lines()).isEqualTo(1);
    var row =
        overviewService.overview(tenant.getId(), 0).rows().stream()
            .filter(r -> r.professionalId().equals(jorgelina.getId()))
            .findFirst()
            .orElseThrow();
    assertThat(row.lineCount()).isEqualTo(1);
  }

  @Test
  void theEntriesOfARecalculatedLineShareItsInvoiceLine() {
    configureSalon();
    accrue(invoice(brushingLargo, jorgelina, "100000"));
    change(
        "PERIOD_START",
        new ConfigChange("RETENTION_PROFILE", null, jorgelina.getId(), null, "5", null));
    java.time.LocalDate today = java.time.LocalDate.now();
    var views =
        queryService.entries(
            tenant.getId(), today.minusDays(1), today.plusDays(1), List.of(), null, null);
    // The original, its reversal and the new commission: the screen shows them as one sale.
    assertThat(views).hasSize(3);
    assertThat(views).extracting(v -> v.invoiceLineId()).doesNotContainNull();
    assertThat(views.stream().map(v -> v.invoiceLineId()).distinct()).hasSize(1);
  }

  @Test
  void theLastLayerThatExistsWins() {
    configureSalon();
    // Default % → group (50) → service for everybody → professional for that service.
    change("IMMEDIATE", new ConfigChange("DEFAULT_SERVICE", null, null, "10", null));
    accrue(invoice(banoDeCrema, jorgelina, "100000")); // no group, no own %: the general 10 %
    change("IMMEDIATE", new ConfigChange("RULE", brushingLargo.getId(), null, "30", null));
    accrue(invoice(brushingLargo, jorgelina, "100000")); // the service beats its group
    change(
        "IMMEDIATE",
        new ConfigChange("RULE", brushingLargo.getId(), jorgelina.getId(), "70", null));
    accrue(invoice(brushingLargo, jorgelina, "100000")); // she beats the service
    List<CommissionEntry> es = entries();
    assertThat(es).hasSize(3);
    assertThat(es.get(0).getRuleOrigin()).isEqualTo(CommissionRuleOrigin.TENANT_DEFAULT_SERVICE);
    assertThat(es.get(0).getCommissionAmount()).isEqualByComparingTo("10000");
    assertThat(es.get(1).getRuleOrigin()).isEqualTo(CommissionRuleOrigin.ITEM);
    assertThat(es.get(1).getCommissionAmount()).isEqualByComparingTo("30000");
    assertThat(es.get(2).getRuleOrigin()).isEqualTo(CommissionRuleOrigin.BENEFICIARY_ITEM);
    assertThat(es.get(2).getCommissionAmount()).isEqualByComparingTo("70000");
  }

  @Test
  void theRetentionIsTheProfessionalsAndComesOutOfTheCommissionInEveryLayer() {
    configureSalon();
    // The default % has no retention of its own: Gaby's 5 % comes out of it too.
    change("IMMEDIATE", new ConfigChange("DEFAULT_SERVICE", null, null, "20", null));
    accrue(invoice(banoDeCrema, gaby, "100000"));
    CommissionEntry e = entries().get(0);
    assertThat(e.getRetentionPercent()).isEqualByComparingTo("5");
    assertThat(e.getRetentionAmount()).isEqualByComparingTo("5000");
    assertThat(e.getCommissionAmount()).isEqualByComparingTo("15000"); // 20 % − 5 %
    // Never more than the commission itself: a 3 % rule with a 5 % retention pays nothing.
    change("IMMEDIATE", new ConfigChange("RULE", banoDeCrema.getId(), null, "3", null));
    accrue(invoice(banoDeCrema, gaby, "100000"));
    CommissionEntry small = entries().get(1);
    assertThat(small.getRetentionAmount()).isEqualByComparingTo("3000");
    assertThat(small.getCommissionAmount()).isEqualByComparingTo("0");
    // Without the retention for aguinaldo on the salon, nobody retains.
    change("IMMEDIATE", new ConfigChange("AGUINALDO_ENABLED", null, null, "false", null));
    accrue(invoice(banoDeCrema, gaby, "100000"));
    assertThat(entries().get(2).getRetentionAmount()).isEqualByComparingTo("0");
    assertThat(entries().get(2).getCommissionAmount()).isEqualByComparingTo("3000");
  }

  @Test
  void invalidRuleValuesAreRejectedWithCodes() {
    assertThatThrownBy(() -> change("IMMEDIATE", groupRule(brushingGroup, null, "120")))
        .hasMessageContaining("COMMISSION_PERCENT_OUT_OF_RANGE");
    assertThatThrownBy(() -> change("IMMEDIATE", groupRule(brushingGroup, null, "45|0|-3|")))
        .hasMessageContaining("COMMISSION_FIXED_AMOUNT_INVALID");
    assertThatThrownBy(() -> change("IMMEDIATE", groupRule(999_999L, null, "45")))
        .hasMessageContaining("COMMISSION_GROUP_NOT_FOUND");
    assertThatThrownBy(
            () ->
                change(
                    "IMMEDIATE", new ConfigChange("FIXED_DESTINATION", null, null, "NOBODY", null)))
        .hasMessageContaining("COMMISSION_FIXED_DESTINATION_INVALID");
  }

  @Test
  void theRatesViewShowsWhatEachGroupAndServicePaysAndWhoIsPaidDifferently() {
    configureSalon();
    change("IMMEDIATE", new ConfigChange("RULE", brushingLargo.getId(), null, "30", null));
    change("IMMEDIATE", new ConfigChange("RULE", brushingLargo.getId(), gaby.getId(), "55", null));
    change("IMMEDIATE", new ConfigChange("DEFAULT_SERVICE", null, null, "10", null));
    var view = groupService.ratesView(tenant.getId(), null);
    assertThat(view.baseType()).isEqualTo("TAX_INCLUDED");
    assertThat(view.generalServicePercent()).isEqualByComparingTo("10");
    assertThat(view.defaultFixedDestination()).isEqualTo("PROFESSIONAL");

    var brushing =
        view.groups().stream().filter(g -> g.id().equals(brushingGroup)).findFirst().orElseThrow();
    assertThat(brushing.percent()).isEqualByComparingTo("50");
    var largo = brushing.items().get(0);
    assertThat(largo.name()).isEqualTo("Brushing pelo largo");
    assertThat(largo.source()).isEqualTo("SERVICE");
    assertThat(largo.ownPercent()).isEqualByComparingTo("30");
    assertThat(largo.normalPercent()).isEqualByComparingTo("30");
    assertThat(largo.exceptions()).hasSize(1);
    assertThat(largo.exceptions().get(0).professionalName()).isEqualTo("Gaby");
    assertThat(largo.exceptions().get(0).percent()).isEqualByComparingTo("55");

    var lashes =
        view.groups().stream().filter(g -> g.id().equals(lashesGroup)).findFirst().orElseThrow();
    assertThat(lashes.percent()).isEqualByComparingTo("50");
    assertThat(lashes.fixedAmount()).isEqualByComparingTo("20000");
    var pestanasRow = lashes.items().get(0);
    assertThat(pestanasRow.source()).isEqualTo("GROUP");
    assertThat(pestanasRow.ownPercent()).isNull();
    assertThat(pestanasRow.normalPercent()).isEqualByComparingTo("50");
    assertThat(pestanasRow.normalFixedAmount()).isEqualByComparingTo("20000");

    // An item without group nor % of its own pays the general % of its kind.
    var bano =
        view.ungrouped().stream()
            .filter(i -> i.name().equals("Baño de crema"))
            .findFirst()
            .orElseThrow();
    assertThat(bano.source()).isEqualTo("GENERAL");
    assertThat(bano.normalPercent()).isEqualByComparingTo("10");
  }

  @Test
  void theExceptionsListShowsWhereTheInheritedPercentComesFrom() {
    configureSalon();
    change("IMMEDIATE", new ConfigChange("DEFAULT_SERVICE", null, null, "10", null));
    change("IMMEDIATE", new ConfigChange("RULE", brushingLargo.getId(), null, "30", null));
    var items =
        configService.rulesView(tenant.getId(), "SERVICE", null).categories().stream()
            .flatMap(c -> c.items().stream())
            .collect(java.util.stream.Collectors.toMap(i -> i.name(), i -> i));

    // Pestañas has no % of its own: it pays its group's (50), not the general one (10).
    var pestanasRow = items.get("Pestañas pelo a pelo");
    assertThat(pestanasRow.ownStandard()).isFalse();
    assertThat(pestanasRow.standardPercent()).isEqualByComparingTo("50");
    assertThat(pestanasRow.inheritedPercent()).isEqualByComparingTo("50");
    assertThat(pestanasRow.inheritedFrom()).isEqualTo("GROUP");
    assertThat(pestanasRow.inheritedGroupName()).isEqualTo("Pestañas");

    // Brushing has its own 30 %, but what it would pay without it is its group's 50 %.
    var largo = items.get("Brushing pelo largo");
    assertThat(largo.ownStandard()).isTrue();
    assertThat(largo.standardPercent()).isEqualByComparingTo("30");
    assertThat(largo.inheritedPercent()).isEqualByComparingTo("50");
    assertThat(largo.inheritedFrom()).isEqualTo("GROUP");
    assertThat(largo.inheritedGroupName()).isEqualTo("Brushing");

    // Without a group it pays the general %, and says so.
    var bano = items.get("Baño de crema");
    assertThat(bano.standardPercent()).isEqualByComparingTo("10");
    assertThat(bano.inheritedPercent()).isEqualByComparingTo("10");
    assertThat(bano.inheritedFrom()).isEqualTo("GENERAL");
    assertThat(bano.inheritedGroupName()).isNull();

    // A group without its own % falls back to the general one.
    change("IMMEDIATE", groupRule(lashesGroup, null, null));
    var after =
        configService.rulesView(tenant.getId(), "SERVICE", null).categories().stream()
            .flatMap(c -> c.items().stream())
            .filter(i -> i.name().equals("Pestañas pelo a pelo"))
            .findFirst()
            .orElseThrow();
    assertThat(after.inheritedFrom()).isEqualTo("GENERAL");
    assertThat(after.inheritedPercent()).isEqualByComparingTo("10");
  }

  @Test
  void aRetentionProfileIsStoredAndListedInTheSettings() {
    change(
        "IMMEDIATE",
        new ConfigChange("RETENTION_PROFILE", null, gaby.getId(), null, "5", null),
        new ConfigChange("AGUINALDO_DEFAULT", null, null, "5", null),
        new ConfigChange("FIXED_DESTINATION", null, null, "SALON", null));
    var settings = configService.settings(tenant.getId());
    assertThat(settings.fixedDestination()).isEqualTo("SALON");
    assertThat(settings.aguinaldoDefaultPercent()).isEqualByComparingTo("5");
    assertThat(settings.retentionProfiles())
        .filteredOn(r -> r.professionalName().equals("Gaby"))
        .singleElement()
        .satisfies(r -> assertThat(r.percent()).isEqualByComparingTo("5"));
    assertThat(settings.retentionProfiles())
        .filteredOn(r -> r.professionalName().equals("Jorgelina"))
        .singleElement()
        .satisfies(r -> assertThat(r.percent()).isNull());
  }

  @Test
  void groupsAreManagedAndSuggestedByName() {
    long tenantId = tenant.getId();
    long treatmentGroup = groupService.create(tenantId, "Tratamiento").id();
    assertThatThrownBy(() -> groupService.create(tenantId, "  brushing "))
        .hasMessageContaining("COMMISSION_GROUP_NAME_TAKEN");
    assertThatThrownBy(() -> groupService.create(tenantId, "   "))
        .hasMessageContaining("COMMISSION_GROUP_NAME_REQUIRED");

    var ungrouped = groupService.ungrouped(tenantId, ServiceKind.SERVICE);
    assertThat(ungrouped).hasSize(1);
    assertThat(ungrouped.get(0).name()).isEqualTo("Baño de crema");
    assertThat(ungrouped.get(0).suggestion().groupName()).isEqualTo("Tratamiento");
    assertThat(ungrouped.get(0).suggestion().groupId()).isEqualTo(treatmentGroup);

    groupService.assign(
        tenantId, List.of(new GroupAssignment(banoDeCrema.getId(), treatmentGroup)));
    assertThat(groupService.ungrouped(tenantId, ServiceKind.SERVICE)).isEmpty();

    List<GroupView> groups = groupService.list(tenantId);
    assertThat(groups)
        .extracting(GroupView::name)
        .containsExactly("Brushing", "Pestañas", "Tratamiento");
    assertThat(groups.get(0).serviceCount()).isEqualTo(1);
    assertThat(groups.get(0).serviceNames()).containsExactly("Brushing pelo largo");

    // A group with services but no rule history can go; one with rules cannot.
    groupService.delete(tenantId, treatmentGroup);
    assertThat(serviceRepository.findById(banoDeCrema.getId()).orElseThrow().getCommissionGroupId())
        .isNull();
    configureSalon();
    assertThatThrownBy(() -> groupService.delete(tenantId, brushingGroup))
        .hasMessageContaining("COMMISSION_GROUP_HAS_RULES");
  }

  @Test
  void settlingAnApprovedSettlementKeepsTheFundAndPaymentDoesNotTouchIt() {
    configureSalon();
    CommissionSettlement s = settledGaby();
    settlementService.pay(
        tenant.getId(), s.getId(), "admin@test", new PayRequest("CASH", LocalDate.now(), ""));
    assertThat(aguinaldoService.balanceOf(tenant.getId(), gaby.getId()))
        .isEqualByComparingTo("6500");
  }

  @Test
  void theServicesListShowsEveryItemWithItsGroupOrTheNameSuggestion() {
    long tenantId = tenant.getId();
    long treatment = groupService.create(tenantId, "Tratamiento").id();
    var rows = groupService.services(tenantId, ServiceKind.SERVICE);
    assertThat(rows).hasSize(3);
    var brushing =
        rows.stream().filter(r -> r.name().equals("Brushing pelo largo")).findFirst().orElseThrow();
    assertThat(brushing.groupName()).isEqualTo("Brushing");
    assertThat(brushing.suggestion()).isNull();
    assertThat(brushing.categoryName()).isNotBlank();
    var bano =
        rows.stream().filter(r -> r.name().equals("Baño de crema")).findFirst().orElseThrow();
    assertThat(bano.groupId()).isNull();
    assertThat(bano.suggestion().groupId()).isEqualTo(treatment);
    assertThat(bano.suggestion().reason()).isEqualTo("bano de crema");
    assertThat(groupService.services(tenantId, ServiceKind.PRODUCT)).isEmpty();
  }

  @Test
  void theProfessionalsSummaryCountsWhereEachIsPaidDifferentlyAlphabetically() {
    configureSalon();
    var summary = groupService.professionalsSummary(tenant.getId());
    assertThat(summary.aguinaldoEnabled()).isTrue();
    assertThat(summary.professionals())
        .extracting(p -> p.name().toLowerCase())
        .containsExactly("gaby", "jorgelina");
    assertThat(summary.professionals().get(0).ruleCount()).isZero();
    assertThat(summary.professionals().get(1).ruleCount()).isZero();
    assertThat(summary.professionals().get(0).retentionPercent()).isEqualByComparingTo("5");
    change(
        "IMMEDIATE",
        new ConfigChange("RULE", brushingLargo.getId(), jorgelina.getId(), "60", null));
    assertThat(groupService.professionalsSummary(tenant.getId()).professionals().get(1).ruleCount())
        .isEqualTo(1);
  }

  @Test
  void theOverviewShowsEveryActiveProfessionalWithItsStateInThePeriod() {
    configureSalon();
    accrue(invoice(brushingLargo, gaby, "100000")); // 45.000 + 5.000 retained
    accrue(invoice(brushingLargo, jorgelina, "100000")); // 50.000

    var ov = overviewService.overview(tenant.getId(), 0);
    assertThat(ov.rows())
        .extracting(r -> r.professionalName().toLowerCase())
        .containsExactly("gaby", "jorgelina");
    assertThat(ov.rows()).extracting(r -> r.status()).containsExactly("UNSETTLED", "UNSETTLED");
    assertThat(ov.rows().get(0).amount()).isEqualByComparingTo("45000");
    assertThat(ov.rows().get(0).retention()).isEqualByComparingTo("5000");
    assertThat(ov.rows().get(0).ruleCount()).isZero(); // nobody is paid differently yet
    // Each row says how many movements are behind its amount; nothing is paid yet.
    assertThat(ov.rows()).extracting(r -> r.lineCount()).containsExactly(1, 1);
    assertThat(ov.rows()).extracting(r -> r.paidOn()).containsOnlyNulls();
    assertThat(ov.total()).isEqualByComparingTo("95000");
    assertThat(ov.retentionTotal()).isEqualByComparingTo("5000");
    assertThat(ov.unsettled()).isEqualTo(2);
    assertThat(ov.groupCount()).isEqualTo(2);
    assertThat(ov.ungroupedServices()).isEqualTo(1); // "Baño de crema" has no group
    assertThat(ov.aguinaldoEnabled()).isTrue();
    assertThat(ov.aguinaldoBalance()).isEqualByComparingTo("0");
    // HU-COM-18: only Gaby retains (the other professional legitimately does not).
    assertThat(ov.professionalsRetaining()).isEqualTo(1);
    assertThat(ov.period().from()).isNotNull();

    LocalDate today = LocalDate.now(configService.zone());
    CommissionSettlement draft =
        settlementService
            .generate(
                tenant.getId(),
                "admin@test",
                new GenerateSettlementsRequest(today, today, List.of(gaby.getId())))
            .get(0);
    var afterGenerate = overviewService.overview(tenant.getId(), 0);
    assertThat(afterGenerate.rows().get(0).status()).isEqualTo("DRAFT");
    assertThat(afterGenerate.rows().get(0).settlementId()).isEqualTo(draft.getId());
    assertThat(afterGenerate.drafts()).isEqualTo(1);
    assertThat(afterGenerate.unsettled()).isEqualTo(1);

    settlementService.approve(tenant.getId(), draft.getId(), "admin@test");
    var approved = overviewService.overview(tenant.getId(), 0);
    assertThat(approved.rows().get(0).status()).isEqualTo("APPROVED");
    assertThat(approved.approved()).isEqualTo(1);
    assertThat(approved.aguinaldoBalance()).isEqualByComparingTo("5000");

    settlementService.pay(
        tenant.getId(), draft.getId(), "admin@test", new PayRequest("CASH", today, ""));
    var paidView = overviewService.overview(tenant.getId(), 0);
    assertThat(paidView.paid()).isEqualTo(1);
    assertThat(paidView.rows().get(0).paidOn()).isNotNull();
    assertThat(paidView.rows().get(0).lineCount()).isEqualTo(1);
    assertThat(paidView.rows().get(1).paidOn()).isNull(); // the other one is still unsettled

    // The period before has nothing yet; offsets above 0 are treated as the current one.
    var before = overviewService.overview(tenant.getId(), -1);
    assertThat(before.offset()).isEqualTo(-1);
    assertThat(before.rows()).extracting(r -> r.status()).containsOnly("NONE");
    assertThat(before.period().to()).isBefore(ov.period().from());
    assertThat(overviewService.overview(tenant.getId(), 5).offset()).isZero();
  }

  @Test
  void theOverviewListsEveryActiveProfessionalEvenWithNothingToSettle() {
    var ov = overviewService.overview(tenant.getId(), 0);
    assertThat(ov.professionalsRetaining()).isZero();
    assertThat(ov.rows()).extracting(r -> r.status()).containsOnly("NONE");
  }
}
