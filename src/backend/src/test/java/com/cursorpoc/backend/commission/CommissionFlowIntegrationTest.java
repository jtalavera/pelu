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
import com.cursorpoc.backend.domain.enums.CommissionEntrySource;
import com.cursorpoc.backend.domain.enums.CommissionRuleOrigin;
import com.cursorpoc.backend.domain.enums.CommissionSettlementStatus;
import com.cursorpoc.backend.domain.enums.ServiceKind;
import com.cursorpoc.backend.repository.CommissionEntryRepository;
import com.cursorpoc.backend.repository.CommissionSettlementRepository;
import com.cursorpoc.backend.repository.ProfessionalRepository;
import com.cursorpoc.backend.repository.SalonServiceRepository;
import com.cursorpoc.backend.repository.ServiceCategoryRepository;
import com.cursorpoc.backend.repository.TaxRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.repository.TierRepository;
import com.cursorpoc.backend.web.dto.CommissionDtos.AdjustmentRequest;
import com.cursorpoc.backend.web.dto.CommissionDtos.ApplyChangesRequest;
import com.cursorpoc.backend.web.dto.CommissionDtos.ApplyChangesResponse;
import com.cursorpoc.backend.web.dto.CommissionDtos.ConfigChange;
import com.cursorpoc.backend.web.dto.CommissionDtos.GenerateSettlementsRequest;
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
 * Módulo de comisiones end-to-end against the real JPA mapping (H2): accrual (HU-COM-04), void
 * reversal (HU-COM-05), settlements (HU-COM-06) and mid-period changes (HU-COM-09). Each test uses
 * its own tenant; transactions are those of the services (preview relies on a real rollback).
 */
@SpringBootTest
@ActiveProfiles("test")
class CommissionFlowIntegrationTest {

  private static final AtomicLong IDS = new AtomicLong(900_000);

  @Autowired private TenantRepository tenantRepository;
  @Autowired private TierRepository tierRepository;
  @Autowired private ProfessionalRepository professionalRepository;
  @Autowired private ServiceCategoryRepository categoryRepository;
  @Autowired private SalonServiceRepository serviceRepository;
  @Autowired private TaxRepository taxRepository;
  @Autowired private CommissionEntryRepository entryRepository;
  @Autowired private CommissionSettlementRepository settlementRepository;
  @Autowired private CommissionConfigService configService;
  @Autowired private CommissionSettlementService settlementService;
  @Autowired private CommissionAccrualService accrualService;
  @Autowired private PlatformTransactionManager transactionManager;
  @Autowired private CommissionReassignmentService reassignmentService;
  @Autowired private CommissionQueryService queryService;

  private TransactionTemplate tx;
  private Tenant tenant;
  private Professional ana;
  private Professional bea;
  private SalonService corte;
  private SalonService shampoo;

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
    ana = professional("Ana");
    bea = professional("Bea");
    Tax iva = new Tax();
    iva.setTenant(tenant);
    iva.setName("IVA 10");
    iva.setRate(BigDecimal.TEN);
    iva.setActive(true);
    iva = taxRepository.save(iva);
    corte = item("Corte", ServiceKind.SERVICE, iva);
    shampoo = item("Shampoo", ServiceKind.PRODUCT, iva);
  }

  private Professional professional(String name) {
    Professional p = new Professional();
    p.setTenant(tenant);
    p.setFullName(name);
    p.setActive(true);
    return professionalRepository.save(p);
  }

  private SalonService item(String name, ServiceKind kind, Tax tax) {
    ServiceCategory c = new ServiceCategory();
    c.setTenant(tenant);
    c.setName(name + " cat " + System.nanoTime());
    c.setActive(true);
    c.setKind(kind);
    c = categoryRepository.save(c);
    SalonService s = new SalonService();
    s.setTenant(tenant);
    s.setCategory(c);
    s.setName(name);
    s.setPriceMinor(BigDecimal.valueOf(110_000));
    s.setDurationMinutes(30);
    s.setActive(true);
    s.setKind(kind);
    s.setTax(tax);
    return serviceRepository.save(s);
  }

  /** A transient invoice: the accrual only reads ids, tenant, lines and the issue date. */
  private Invoice invoice(Object... lines) {
    Invoice inv = new Invoice();
    inv.setId(IDS.incrementAndGet());
    inv.setTenant(tenant);
    inv.setInvoiceNumber((int) (IDS.get() % 1_000_000));
    inv.setIssuedAt(Instant.now());
    for (int i = 0; i < lines.length; i += 3) {
      InvoiceLine l = new InvoiceLine();
      l.setId(IDS.incrementAndGet());
      l.setInvoice(inv);
      l.setSalonService((SalonService) lines[i]);
      l.setProfessional((Professional) lines[i + 1]);
      BigDecimal total = new BigDecimal(lines[i + 2].toString());
      l.setDescription(((SalonService) lines[i]).getName());
      l.setQuantity(1);
      l.setUnitPrice(total);
      l.setLineTotal(total);
      l.setTaxRate(BigDecimal.TEN);
      l.setTaxAmount(CommissionCalculator.includedTax(total, BigDecimal.TEN));
      inv.getLines().add(l);
    }
    return inv;
  }

  private void accrue(Invoice inv) {
    tx.executeWithoutResult(s -> accrualService.accrue(inv));
  }

  private void voidInvoice(Invoice inv) {
    tx.executeWithoutResult(s -> accrualService.reverseAll(inv, CommissionLedger.REASON_VOID));
  }

  private ApplyChangesResponse change(String mode, ConfigChange... changes) {
    return configService.applyChanges(
        tenant.getId(),
        "admin@test",
        new ApplyChangesRequest(List.of(changes), mode, false, false));
  }

  private static ConfigChange rule(SalonService s, Professional p, String value) {
    return new ConfigChange("RULE", s.getId(), p == null ? null : p.getId(), value, null);
  }

  private List<CommissionEntry> entries() {
    return entryRepository.findForReport(
        tenant.getId(), Instant.EPOCH, Instant.now().plusSeconds(3600), null);
  }

  private BigDecimal total(List<CommissionEntry> es) {
    return es.stream()
        .map(CommissionEntry::getCommissionAmount)
        .reduce(BigDecimal.ZERO, BigDecimal::add);
  }

  @Test
  void accruesWithExceptionGeneralAndDefaultsOfEachKind() {
    change(
        "IMMEDIATE",
        new ConfigChange("DEFAULT_PRODUCT", null, null, "10", null),
        rule(corte, null, "40"),
        rule(corte, bea, "50"));
    accrue(
        invoice(
            corte, ana, "110000", corte, bea, "110000", shampoo, ana, "110000", corte, null,
            "110000"));

    List<CommissionEntry> es = entries();
    assertThat(es).hasSize(3); // the line without professional generates nothing (C17)
    assertThat(es)
        .extracting(CommissionEntry::getRuleOrigin)
        .containsExactly(
            CommissionRuleOrigin.ITEM,
            CommissionRuleOrigin.BENEFICIARY_ITEM,
            CommissionRuleOrigin.TENANT_DEFAULT_PRODUCT);
    assertThat(es)
        .extracting(e -> e.getCommissionAmount().intValue())
        .containsExactly(40000, 50000, 10000);
    assertThat(es.get(2).getItemKind()).isEqualTo(ServiceKind.PRODUCT);
  }

  @Test
  void accrualIsIdempotentAndUsesTheTenantBase() {
    change(
        "IMMEDIATE",
        new ConfigChange("BASE", null, null, "TAX_INCLUDED", null),
        rule(corte, null, "40"));
    Invoice inv = invoice(corte, ana, "110000");
    accrue(inv);
    accrue(inv);
    List<CommissionEntry> es = entries();
    assertThat(es).hasSize(1);
    assertThat(es.get(0).getCommissionAmount()).isEqualByComparingTo("44000");
  }

  @Test
  void voidBeforeSettlementCancelsOutAndAfterApprovalGoesToNextSettlement() {
    change("IMMEDIATE", rule(corte, null, "40"));
    Invoice first = invoice(corte, ana, "110000");
    Invoice second = invoice(corte, ana, "110000");
    accrue(first);
    accrue(second);
    voidInvoice(first);
    voidInvoice(first); // idempotent
    assertThat(entries()).hasSize(3);
    assertThat(total(entries())).isEqualByComparingTo("40000");

    LocalDate today = LocalDate.now(configService.zone());
    List<CommissionSettlement> created =
        settlementService.generate(
            tenant.getId(), "admin@test", new GenerateSettlementsRequest(today, today, null));
    assertThat(created).hasSize(1);
    CommissionSettlement s = settlementRepository.findById(created.get(0).getId()).orElseThrow();
    assertThat(s.getTotalAmount()).isEqualByComparingTo("40000");
    settlementService.approve(tenant.getId(), s.getId(), "admin@test");

    voidInvoice(second);
    CommissionSettlement after = settlementRepository.findById(s.getId()).orElseThrow();
    assertThat(after.getTotalAmount()).isEqualByComparingTo("40000"); // approved: untouched
    List<CommissionEntry> unsettled =
        entryRepository.findUnsettled(tenant.getId(), ana.getId(), Instant.now().plusSeconds(60));
    assertThat(unsettled).hasSize(1);
    assertThat(unsettled.get(0).getCommissionAmount()).isEqualByComparingTo("-40000");
    assertThat(unsettled.get(0).getSourceType()).isEqualTo(CommissionEntrySource.REVERSAL);

    assertThatThrownBy(
            () ->
                settlementService.generate(
                    tenant.getId(),
                    "admin@test",
                    new GenerateSettlementsRequest(today, today, List.of(ana.getId()))))
        .hasMessageContaining("COMMISSION_PERIOD_OVERLAP");
  }

  @Test
  void settlementLifecycleWithAdjustmentsAndNegativeCarry() {
    change("IMMEDIATE", rule(corte, null, "40"));
    accrue(invoice(corte, ana, "110000"));
    LocalDate today = LocalDate.now(configService.zone());
    CommissionSettlement s =
        settlementService
            .generate(
                tenant.getId(), "admin@test", new GenerateSettlementsRequest(today, today, null))
            .get(0);
    assertThatThrownBy(
            () ->
                settlementService.addAdjustment(
                    tenant.getId(), s.getId(), "a", new AdjustmentRequest(BigDecimal.ONE, " ")))
        .hasMessageContaining("SETTLEMENT_ADJUSTMENT_REASON_REQUIRED");
    settlementService.addAdjustment(
        tenant.getId(),
        s.getId(),
        "a",
        new AdjustmentRequest(new BigDecimal("-50000"), "Adelanto"));
    assertThat(settlementRepository.findById(s.getId()).get().getTotalAmount())
        .isEqualByComparingTo("-10000");

    settlementService.approve(tenant.getId(), s.getId(), "a");
    CommissionSettlement approved = settlementRepository.findById(s.getId()).get();
    assertThat(approved.getTotalAmount()).isEqualByComparingTo("0");
    assertThat(
            total(
                entryRepository.findUnsettled(
                    tenant.getId(), ana.getId(), Instant.now().plusSeconds(60))))
        .isEqualByComparingTo("-10000");
    assertThatThrownBy(
            () ->
                settlementService.addAdjustment(
                    tenant.getId(), s.getId(), "a", new AdjustmentRequest(BigDecimal.ONE, "x")))
        .hasMessageContaining("SETTLEMENT_NOT_EDITABLE");

    settlementService.pay(
        tenant.getId(), s.getId(), "a", new PayRequest("TRANSFER", today, "OP-1"));
    assertThat(settlementRepository.findById(s.getId()).get().getStatus())
        .isEqualTo(CommissionSettlementStatus.PAID);
    assertThatThrownBy(() -> settlementService.voidSettlement(tenant.getId(), s.getId(), "a", "x"))
        .hasMessageContaining("SETTLEMENT_INVALID_STATE_TRANSITION");
  }

  @Test
  void periodStartRecalculatesDraftButNotApprovedAndPreviewPersistsNothing() {
    change("IMMEDIATE", rule(corte, null, "40"));
    accrue(invoice(corte, ana, "110000"));
    accrue(invoice(corte, bea, "110000"));
    LocalDate today = LocalDate.now(configService.zone());
    CommissionSettlement anaSettlement =
        settlementService
            .generate(
                tenant.getId(),
                "a",
                new GenerateSettlementsRequest(today, today, List.of(ana.getId())))
            .get(0);
    settlementService.approve(tenant.getId(), anaSettlement.getId(), "a");
    CommissionSettlement beaDraft =
        settlementService
            .generate(
                tenant.getId(),
                "a",
                new GenerateSettlementsRequest(today, today, List.of(bea.getId())))
            .get(0);
    accrue(invoice(corte, bea, "110000")); // unsettled

    ApplyChangesResponse preview =
        configService.applyChanges(
            tenant.getId(),
            "a",
            new ApplyChangesRequest(List.of(rule(corte, null, "50")), "PERIOD_START", false, true));
    assertThat(preview.recalculation().entriesRecalculated()).isEqualTo(2);
    assertThat(preview.recalculation().entriesExcluded()).isEqualTo(1);
    assertThat(preview.recalculation().deltaAmount()).isEqualByComparingTo("20000");
    assertThat(entries()).hasSize(3); // rolled back

    ApplyChangesResponse applied = change("PERIOD_START", rule(corte, null, "50"));
    assertThat(applied.recalculation().entriesRecalculated()).isEqualTo(2);
    assertThat(settlementRepository.findById(anaSettlement.getId()).get().getTotalAmount())
        .isEqualByComparingTo("40000");
    assertThat(settlementRepository.findById(beaDraft.getId()).get().getTotalAmount())
        .isEqualByComparingTo("50000");

    // Voiding after a recalculation reverses the live revision (C21).
    List<CommissionEntry> live =
        entryRepository.findLiveLineEntriesSince(tenant.getId(), Instant.EPOCH);
    assertThat(live).extracting(CommissionEntry::getRevision).contains(2);
  }

  @Test
  void scheduledChangesNeedConfirmationToBeReplacedAndCanBeCancelled() {
    change("IMMEDIATE", rule(corte, null, "40"));
    ApplyChangesResponse scheduled = change("NEXT_PERIOD", rule(corte, null, "45"));
    assertThat(scheduled.effectiveFrom()).isAfter(Instant.now());
    accrue(invoice(corte, ana, "110000"));
    assertThat(entries().get(0).getPercentApplied()).isEqualByComparingTo("40");

    assertThatThrownBy(() -> change("IMMEDIATE", rule(corte, null, "42")))
        .hasMessageContaining("COMMISSION_PENDING_CHANGE_EXISTS");
    assertThatThrownBy(() -> change(null, rule(corte, null, "42")))
        .hasMessageContaining("COMMISSION_CHANGE_APPLY_MODE_REQUIRED");

    var settings = configService.settings(tenant.getId());
    assertThat(settings.scheduledChanges()).hasSize(1);
    configService.cancelScheduled(tenant.getId(), settings.scheduledChanges().get(0).id(), "a");
    assertThat(configService.settings(tenant.getId()).scheduledChanges()).isEmpty();

    assertThat(configService.makeScheduledEffectiveNow(tenant.getId())).isZero();
  }

  @Test
  void inactiveProfessionalCannotGetANewException() {
    bea.setActive(false);
    professionalRepository.save(bea);
    assertThatThrownBy(() -> change("IMMEDIATE", rule(corte, bea, "50")))
        .hasMessageContaining("COMMISSION_PROFESSIONAL_INACTIVE");
  }

  @Test
  void reassignMovesTheCommissionToTheRightProfessionalWithItsOwnRules() {
    change("IMMEDIATE", rule(corte, null, "40"), rule(corte, bea, "50"));
    Invoice inv = invoice(corte, ana, "110000");
    accrue(inv);
    LocalDate today = LocalDate.now(configService.zone());
    CommissionSettlement anaDraft =
        settlementService
            .generate(
                tenant.getId(),
                "a",
                new GenerateSettlementsRequest(today, today, List.of(ana.getId())))
            .get(0);
    CommissionEntry wrong = entries().get(0);

    assertThatThrownBy(
            () ->
                reassignmentService.reassign(
                    tenant.getId(),
                    wrong.getId(),
                    "a",
                    new com.cursorpoc.backend.web.dto.CommissionDtos.ReassignRequest(
                        bea.getId(), " ")))
        .hasMessageContaining("COMMISSION_REASSIGN_REASON_REQUIRED");
    assertThatThrownBy(
            () ->
                reassignmentService.reassign(
                    tenant.getId(),
                    wrong.getId(),
                    "a",
                    new com.cursorpoc.backend.web.dto.CommissionDtos.ReassignRequest(
                        ana.getId(), "x")))
        .hasMessageContaining("COMMISSION_REASSIGN_SAME_PROFESSIONAL");

    CommissionEntry fixed =
        reassignmentService.reassign(
            tenant.getId(),
            wrong.getId(),
            "a",
            new com.cursorpoc.backend.web.dto.CommissionDtos.ReassignRequest(
                bea.getId(), "Se cargó a Ana por error"));
    assertThat(fixed.getProfessionalId()).isEqualTo(bea.getId());
    assertThat(fixed.getCommissionAmount()).isEqualByComparingTo("50000"); // Bea's exception
    assertThat(fixed.getSettlementId()).isNull();
    // Ana's draft: the line and its reversal cancel out.
    assertThat(settlementRepository.findById(anaDraft.getId()).get().getTotalAmount())
        .isEqualByComparingTo("0");
    // Only one live entry left; the reversed one can't be reassigned again.
    assertThatThrownBy(
            () ->
                reassignmentService.reassign(
                    tenant.getId(),
                    wrong.getId(),
                    "a",
                    new com.cursorpoc.backend.web.dto.CommissionDtos.ReassignRequest(
                        bea.getId(), "x")))
        .hasMessageContaining("COMMISSION_ENTRY_NOT_REASSIGNABLE");
  }

  @Test
  void reassignAfterApprovalLeavesTheApprovedSettlementUntouched() {
    change("IMMEDIATE", rule(corte, null, "40"));
    accrue(invoice(corte, ana, "110000"));
    LocalDate today = LocalDate.now(configService.zone());
    CommissionSettlement s =
        settlementService
            .generate(tenant.getId(), "a", new GenerateSettlementsRequest(today, today, null))
            .get(0);
    settlementService.approve(tenant.getId(), s.getId(), "a");
    CommissionEntry wrong = entries().get(0);
    reassignmentService.reassign(
        tenant.getId(),
        wrong.getId(),
        "a",
        new com.cursorpoc.backend.web.dto.CommissionDtos.ReassignRequest(
            bea.getId(), "Error de carga"));
    assertThat(settlementRepository.findById(s.getId()).get().getTotalAmount())
        .isEqualByComparingTo("40000");
    Instant later = Instant.now().plusSeconds(60);
    assertThat(total(entryRepository.findUnsettled(tenant.getId(), ana.getId(), later)))
        .isEqualByComparingTo("-40000");
    assertThat(total(entryRepository.findUnsettled(tenant.getId(), bea.getId(), later)))
        .isEqualByComparingTo("40000");
  }

  @Test
  void settlementPreviewShowsWhatWouldBePaidToday() {
    change(
        "IMMEDIATE",
        rule(corte, null, "40"),
        new ConfigChange("DEFAULT_PRODUCT", null, null, "10", null));
    accrue(invoice(corte, ana, "110000", shampoo, ana, "110000"));
    var preview = queryService.settlementPreview(tenant.getId(), ana.getId(), null, null);
    assertThat(preview.total()).isEqualByComparingTo("50000");
    assertThat(preview.servicesTotal()).isEqualByComparingTo("40000");
    assertThat(preview.productsTotal()).isEqualByComparingTo("10000");
    assertThat(preview.lines()).isEqualTo(2);
    assertThat(queryService.settlementPreview(tenant.getId(), bea.getId(), null, null).total())
        .isEqualByComparingTo("0");
  }

  @Test
  void rulesViewGroupsByCategoryWithStandardAndExceptions() {
    change(
        "IMMEDIATE",
        new ConfigChange("DEFAULT_SERVICE", null, null, "30", null),
        rule(corte, bea, "45"));
    var view = configService.rulesView(tenant.getId(), "SERVICE", null);
    assertThat(view.generalPercent()).isEqualByComparingTo("30");
    assertThat(view.itemCount()).isEqualTo(1);
    assertThat(view.itemsWithExceptions()).isEqualTo(1);
    var item = view.categories().get(0).items().get(0);
    assertThat(item.standardPercent()).isEqualByComparingTo("30");
    assertThat(item.ownStandard()).isFalse();
    assertThat(item.baseAmount()).isEqualByComparingTo("100000");
    assertThat(item.exceptions())
        .singleElement()
        .satisfies(
            e -> {
              assertThat(e.professionalId()).isEqualTo(bea.getId());
              assertThat(e.delta()).isEqualByComparingTo("15");
            });
    change("IMMEDIATE", rule(corte, null, "40"));
    var after =
        configService.rulesView(tenant.getId(), "SERVICE", null).categories().get(0).items().get(0);
    assertThat(after.standardPercent()).isEqualByComparingTo("40");
    assertThat(after.ownStandard()).isTrue();
    assertThat(after.exceptions().get(0).delta()).isEqualByComparingTo("5");
  }
}
