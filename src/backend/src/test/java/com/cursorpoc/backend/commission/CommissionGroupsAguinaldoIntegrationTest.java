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
import com.cursorpoc.backend.web.dto.CommissionDtos.GroupRuleRow;
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
        groupRule(brushingGroup, gaby, "45|5|0|"),
        groupRule(lashesGroup, gaby, "45|5|20000|P"),
        groupRule(brushingGroup, jorgelina, "50"));
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
    assertThat(brushing.getRuleOrigin()).isEqualTo(CommissionRuleOrigin.BENEFICIARY_GROUP);
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
  void aPlainItemRuleForTheProfessionalBeatsHerGroupRule() {
    configureSalon();
    change("IMMEDIATE", new ConfigChange("RULE", brushingLargo.getId(), gaby.getId(), "60", null));
    accrue(invoice(brushingLargo, gaby, "100000"));
    CommissionEntry e = entries().get(0);
    assertThat(e.getRuleOrigin()).isEqualTo(CommissionRuleOrigin.BENEFICIARY_ITEM);
    assertThat(e.getCommissionAmount()).isEqualByComparingTo("60000");
    assertThat(e.getRetentionAmount()).isEqualByComparingTo("0");
  }

  @Test
  void invalidRuleValuesAreRejectedWithCodes() {
    assertThatThrownBy(() -> change("IMMEDIATE", groupRule(brushingGroup, gaby, "60|50|0|")))
        .hasMessageContaining("COMMISSION_TOTAL_PERCENT_EXCEEDED");
    assertThatThrownBy(() -> change("IMMEDIATE", groupRule(brushingGroup, gaby, "45|5|-3|")))
        .hasMessageContaining("COMMISSION_FIXED_AMOUNT_INVALID");
    assertThatThrownBy(() -> change("IMMEDIATE", groupRule(999_999L, gaby, "45")))
        .hasMessageContaining("COMMISSION_GROUP_NOT_FOUND");
    assertThatThrownBy(
            () ->
                change(
                    "IMMEDIATE", new ConfigChange("FIXED_DESTINATION", null, null, "NOBODY", null)))
        .hasMessageContaining("COMMISSION_FIXED_DESTINATION_INVALID");
  }

  @Test
  void theProfessionalRulesViewShowsTheCurrentRuleOfEachGroup() {
    configureSalon();
    var view = groupService.professionalRules(tenant.getId(), gaby.getId(), null);
    assertThat(view.aguinaldoEnabled()).isTrue();
    assertThat(view.baseType()).isEqualTo("TAX_INCLUDED");
    assertThat(view.defaultFixedDestination()).isEqualTo("PROFESSIONAL");
    GroupRuleRow lashes =
        view.groups().stream()
            .filter(g -> g.groupId().equals(lashesGroup))
            .findFirst()
            .orElseThrow();
    assertThat(lashes.ownRule()).isTrue();
    assertThat(lashes.percent()).isEqualByComparingTo("45");
    assertThat(lashes.retentionPercent()).isEqualByComparingTo("5");
    assertThat(lashes.fixedAmount()).isEqualByComparingTo("20000");
    assertThat(lashes.fixedDestination()).isEqualTo("PROFESSIONAL");
    assertThat(lashes.serviceCount()).isEqualTo(1);

    var other = groupService.professionalRules(tenant.getId(), jorgelina.getId(), null);
    GroupRuleRow noRule =
        other.groups().stream()
            .filter(g -> g.groupId().equals(lashesGroup))
            .findFirst()
            .orElseThrow();
    assertThat(noRule.ownRule()).isFalse();
    assertThat(noRule.percent()).isNull();
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
  void theProfessionalsSummaryCountsGroupRulesAlphabetically() {
    configureSalon();
    var summary = groupService.professionalsSummary(tenant.getId());
    assertThat(summary.aguinaldoEnabled()).isTrue();
    assertThat(summary.professionals())
        .extracting(p -> p.name().toLowerCase())
        .containsExactly("gaby", "jorgelina");
    assertThat(summary.professionals().get(0).ruleCount()).isEqualTo(2);
    assertThat(summary.professionals().get(1).ruleCount()).isEqualTo(1);
    assertThat(summary.professionals().get(0).retentionPercent()).isNull();
    change("IMMEDIATE", new ConfigChange("RETENTION_PROFILE", null, gaby.getId(), null, "5", null));
    assertThat(
            groupService
                .professionalsSummary(tenant.getId())
                .professionals()
                .get(0)
                .retentionPercent())
        .isEqualByComparingTo("5");
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
    assertThat(ov.rows().get(0).ruleCount()).isEqualTo(2);
    // Each row says how many movements are behind its amount; nothing is paid yet.
    assertThat(ov.rows()).extracting(r -> r.lineCount()).containsExactly(1, 1);
    assertThat(ov.rows()).extracting(r -> r.paidOn()).containsOnlyNulls();
    assertThat(ov.total()).isEqualByComparingTo("95000");
    assertThat(ov.retentionTotal()).isEqualByComparingTo("5000");
    assertThat(ov.unsettled()).isEqualTo(2);
    assertThat(ov.groupCount()).isEqualTo(2);
    assertThat(ov.ungroupedServices()).isEqualTo(1); // "Baño de crema" has no group
    assertThat(ov.professionalsWithoutRules()).isZero();
    assertThat(ov.aguinaldoEnabled()).isTrue();
    assertThat(ov.aguinaldoBalance()).isEqualByComparingTo("0");
    // HU-COM-18: nobody has a usual retention yet; once Gaby has one, only she counts (the other
    // professional legitimately does not retain, which is not a gap).
    assertThat(ov.professionalsRetaining()).isZero();
    change("IMMEDIATE", new ConfigChange("RETENTION_PROFILE", null, gaby.getId(), null, "5", null));
    assertThat(overviewService.overview(tenant.getId(), 0).professionalsRetaining()).isEqualTo(1);
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
  void theOverviewCountsProfessionalsWithoutRules() {
    var ov = overviewService.overview(tenant.getId(), 0);
    assertThat(ov.professionalsWithoutRules()).isEqualTo(2);
    assertThat(ov.professionalsRetaining()).isZero();
    assertThat(ov.rows()).extracting(r -> r.status()).containsOnly("NONE");
  }
}
