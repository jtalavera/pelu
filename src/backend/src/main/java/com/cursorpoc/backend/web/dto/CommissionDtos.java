package com.cursorpoc.backend.web.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;

/** Módulo de comisiones: request / response payloads (requirements femme_modulo_comisiones_v1). */
public final class CommissionDtos {

  private CommissionDtos() {}

  // ── Configuration changes (HU-COM-01/02/09) ───────────────────────────────────────────────

  /**
   * One change of a calculation input. {@code value}: base (NET_OF_TAX / TAX_INCLUDED), a percent
   * (default or rule; null closes a rule) or a periodicity.
   */
  public record ConfigChange(
      String scope,
      Long serviceId,
      Long professionalId,
      Long groupId,
      String value,
      LocalDate validUntil) {

    public ConfigChange(
        String scope, Long serviceId, Long professionalId, String value, LocalDate validUntil) {
      this(scope, serviceId, professionalId, null, value, validUntil);
    }
  }

  public record ApplyChangesRequest(
      List<ConfigChange> changes, String applyMode, boolean replacePending, boolean preview) {}

  public record RecalculationPreview(
      int entriesRecalculated,
      int entriesExcluded,
      BigDecimal deltaAmount,
      List<ProfessionalAmount> deltaByProfessional) {}

  public record ProfessionalAmount(
      Long professionalId, String professionalName, BigDecimal amount) {}

  public record ApplyChangesResponse(
      String applyMode,
      Instant effectiveFrom,
      boolean preview,
      RecalculationPreview recalculation) {}

  public record PeriodInfo(String periodicity, LocalDate from, LocalDate to, LocalDate nextFrom) {}

  public record ApplyModeOptions(
      PeriodInfo currentPeriod,
      Instant immediateFrom,
      Instant nextPeriodFrom,
      Instant periodStartFrom,
      List<String> availableModes) {}

  public record VersionView(
      Long id,
      String scope,
      Long serviceId,
      String serviceName,
      String itemKind,
      Long professionalId,
      String professionalName,
      Long groupId,
      String groupName,
      String value,
      String previousValue,
      Instant effectiveFrom,
      String applyMode,
      String status,
      boolean scheduled,
      Instant createdAt,
      String createdByEmail) {}

  public record SettingsResponse(
      String base,
      BigDecimal defaultPercentService,
      BigDecimal defaultPercentProduct,
      String periodicity,
      PeriodInfo currentPeriod,
      List<VersionView> scheduledChanges,
      List<VersionView> history,
      /* HU-COM-14 */
      String fixedDestination,
      boolean aguinaldoEnabled,
      BigDecimal aguinaldoDefaultPercent,
      List<RetentionProfile> retentionProfiles) {}

  /** HU-COM-14: % retained for aguinaldo from a professional by default (null = she does not). */
  public record RetentionProfile(
      Long professionalId, String professionalName, boolean active, BigDecimal percent) {}

  // ── Commission groups (HU-COM-14) ─────────────────────────────────────────────────────────

  public record GroupView(
      Long id,
      String name,
      int serviceCount,
      List<String> serviceNames,
      int professionalsWithRule) {}

  public record GroupRequest(String name) {}

  public record GroupAssignment(Long serviceId, Long groupId) {}

  public record AssignGroupsRequest(List<GroupAssignment> assignments) {}

  public record GroupSuggestion(Long groupId, String groupName, String reason) {}

  public record UngroupedService(Long serviceId, String name, GroupSuggestion suggestion) {}

  /** One active catalog item with its current commission group (null = none) and a suggestion. */
  public record GroupServiceRow(
      Long serviceId,
      String name,
      String categoryName,
      BigDecimal price,
      Long groupId,
      String groupName,
      GroupSuggestion suggestion) {}

  /** A professional with how many group rules she has and her usual retention %. */
  public record ProfessionalRuleSummary(
      Long professionalId, String name, int ruleCount, BigDecimal retentionPercent) {}

  public record ProfessionalsRuleSummary(
      boolean aguinaldoEnabled, List<ProfessionalRuleSummary> professionals) {}

  /** One group row of a professional's rules (null rule fields = she has no own rule for it). */
  public record GroupRuleRow(
      Long groupId,
      String groupName,
      int serviceCount,
      boolean ownRule,
      BigDecimal percent,
      BigDecimal retentionPercent,
      BigDecimal fixedAmount,
      /** PROFESSIONAL / SALON when the rule sets it, null when it follows the salon default. */
      String fixedDestination,
      String effectiveFixedDestination,
      Long versionId,
      boolean scheduled) {}

  public record ProfessionalRulesView(
      Long professionalId,
      String professionalName,
      boolean active,
      String baseType,
      boolean aguinaldoEnabled,
      BigDecimal retentionProfilePercent,
      String defaultFixedDestination,
      BigDecimal defaultPercentService,
      List<GroupRuleRow> groups) {}

  // ── Aguinaldo fund (HU-COM-14) ────────────────────────────────────────────────────────────

  public record AguinaldoBalance(
      Long professionalId,
      String professionalName,
      boolean active,
      BigDecimal retained,
      BigDecimal paid,
      BigDecimal balance,
      java.time.LocalDate lastPaymentOn) {}

  public record AguinaldoSummary(
      boolean enabled, BigDecimal totalBalance, List<AguinaldoBalance> balances) {}

  public record AguinaldoMovementView(
      /** ACCRUAL (from a settlement), PAYMENT or ADJUSTMENT. */
      String kind,
      java.time.LocalDate date,
      String concept,
      BigDecimal amount,
      BigDecimal balance,
      Long settlementId,
      Long movementId,
      String paymentMethod,
      boolean closesFund,
      String note) {}

  public record AguinaldoDetail(
      Long professionalId,
      String professionalName,
      BigDecimal balance,
      List<AguinaldoMovementView> movements) {}

  /** {@code amount} null = the whole balance. {@code closesFund}: payment on departure. */
  public record AguinaldoPaymentRequest(
      Long professionalId,
      BigDecimal amount,
      java.time.LocalDate paidOn,
      String paymentMethod,
      boolean closesFund,
      String note) {}

  public record AguinaldoBulkPaymentRequest(
      java.time.LocalDate paidOn, String paymentMethod, String note) {}

  public record AguinaldoAdjustmentRequest(Long professionalId, BigDecimal amount, String reason) {}

  // ── Rules (HU-COM-02) ─────────────────────────────────────────────────────────────────────

  public record ExceptionView(
      Long professionalId,
      String professionalName,
      boolean professionalActive,
      BigDecimal percent,
      Long versionId,
      List<VersionView> scheduled) {}

  public record ItemRulesResponse(
      Long serviceId,
      String serviceName,
      String itemKind,
      BigDecimal generalPercent,
      Long generalVersionId,
      BigDecimal defaultPercent,
      List<VersionView> generalScheduled,
      List<ExceptionView> exceptions,
      List<VersionView> history) {}

  /** Rules view (mockup): items grouped by category with their standard % and exceptions. */
  public record RuleException(
      Long professionalId, String professionalName, BigDecimal percent, BigDecimal delta) {}

  public record RuleItem(
      Long serviceId,
      String name,
      BigDecimal price,
      /** Base of one unit at list price with the tenant's calculation base (e.g. without IVA). */
      BigDecimal baseAmount,
      /** % of the item rule, or the general % of its kind when it has none. */
      BigDecimal standardPercent,
      /** True when the item has its own % (differs from / overrides the general one). */
      boolean ownStandard,
      List<RuleException> exceptions,
      boolean scheduled) {}

  public record RuleCategory(Long categoryId, String name, int exceptions, List<RuleItem> items) {}

  public record RuleProfessional(Long id, String fullName) {}

  public record RulesView(
      String kind,
      LocalDate date,
      String baseType,
      BigDecimal generalPercent,
      int itemCount,
      int itemsWithExceptions,
      List<RuleProfessional> professionals,
      List<RuleCategory> categories) {}

  public record ItemWithoutRule(Long serviceId, String serviceName, String itemKind) {}

  // ── Entries / settlements (HU-COM-04..08) ─────────────────────────────────────────────────

  public record EntryView(
      Long id,
      Long professionalId,
      String professionalName,
      String sourceType,
      int revision,
      String reasonCode,
      Long invoiceId,
      String invoiceNumber,
      Long serviceId,
      String itemName,
      String itemKind,
      String baseType,
      BigDecimal lineTotal,
      BigDecimal taxAmount,
      BigDecimal baseAmount,
      BigDecimal percentApplied,
      String ruleOrigin,
      BigDecimal commissionAmount,
      /* HU-COM-14 */
      BigDecimal fixedAmount,
      boolean fixedToProfessional,
      BigDecimal retentionPercent,
      BigDecimal retentionAmount,
      Instant accrualAt,
      Long reversesEntryId,
      Long settlementId,
      String settlementStatus,
      String note,
      /** True for a live INVOICE_LINE entry whose professional can be changed. */
      boolean reassignable) {}

  /** Change the professional who earns a commission (wrong assignment at billing). */
  public record ReassignRequest(Long professionalId, String reason) {}

  /** HU-COM-13: assign a professional to an issued line billed without one. */
  public record AssignLineRequest(Long professionalId, String note) {}

  /** One line → professional pair of {@link AssignInvoiceLinesRequest}. */
  public record LineAssignment(Long invoiceLineId, Long professionalId) {}

  /**
   * "Asignar profesional" from the comprobante detail: several lines of one issued invoice at once,
   * all-or-nothing. A line without professional gets one; a line that has one is reassigned. {@code
   * note} is optional (the reason of a reassignment).
   */
  public record AssignInvoiceLinesRequest(List<LineAssignment> assignments, String note) {}

  /** What the professional would be paid today for an open period (replaces the simulator). */
  public record SettlementPreview(
      Long professionalId,
      String professionalName,
      LocalDate periodFrom,
      LocalDate periodTo,
      BigDecimal total,
      BigDecimal servicesTotal,
      BigDecimal productsTotal,
      BigDecimal adjustmentsTotal,
      BigDecimal retentionTotal,
      int lines,
      List<EntryView> entries,
      List<SettlementView> draftSettlements,
      // Part of {@code total} accrued BEFORE {@code periodFrom} (unsettled commissions carried from
      // earlier periods), and the ids of those entries; {@code total - carriedAmount} is the part
      // of the period itself.
      BigDecimal carriedAmount,
      List<Long> carriedEntryIds) {}

  /**
   * {@code skipOverlapping}: professionals that already have a (non-voided) settlement overlapping
   * the period are skipped instead of failing the whole request with {@code
   * COMMISSION_PERIOD_OVERLAP}.
   */
  public record GenerateSettlementsRequest(
      LocalDate periodFrom,
      LocalDate periodTo,
      List<Long> professionalIds,
      Boolean skipOverlapping) {
    public GenerateSettlementsRequest(
        LocalDate periodFrom, LocalDate periodTo, List<Long> professionalIds) {
      this(periodFrom, periodTo, professionalIds, false);
    }
  }

  /** A professional that already has a settlement overlapping the period to generate. */
  public record SettlementConflict(
      long professionalId,
      String professionalName,
      long settlementId,
      String status,
      LocalDate periodFrom,
      LocalDate periodTo) {}

  /**
   * What «Generar» would do: the overlapping settlements that block it, and how many settlements it
   * can still create for the remaining professionals (those with unsettled commissions).
   */
  public record SettlementGenerationCheck(List<SettlementConflict> conflicts, int generatable) {}

  public record AdjustmentRequest(BigDecimal amount, String reason) {}

  public record PayRequest(String paymentMethod, LocalDate paidOn, String paymentReference) {}

  public record VoidSettlementRequest(String reason) {}

  public record StatusChangeView(
      String fromStatus, String toStatus, Instant changedAt, String changedByEmail) {}

  public record Subtotal(String key, String label, BigDecimal amount, int lines) {}

  public record SettlementView(
      Long id,
      Long professionalId,
      String professionalName,
      LocalDate periodFrom,
      LocalDate periodTo,
      String status,
      BigDecimal totalAmount,
      /* HU-COM-14: retenido para aguinaldo y monto fijo incluido en totalAmount */
      BigDecimal retentionAmount,
      BigDecimal fixedAmount,
      Instant createdAt,
      Instant approvedAt,
      Instant paidAt,
      String paymentMethod,
      String paymentReference,
      String voidReason) {}

  public record SettlementDetail(
      SettlementView settlement,
      List<EntryView> entries,
      List<EntryView> adjustments,
      List<Subtotal> byItem,
      List<Subtotal> byKind,
      boolean mixedBases,
      List<StatusChangeView> history) {}

  public record PagedSettlements(List<SettlementView> items, int page, int size, long total) {}

  // ── Reports (HU-COM-08) / own view (HU-COM-07) ────────────────────────────────────────────

  public record ReportRow(
      String key, String label, String itemKind, BigDecimal amount, int lines) {}

  public record ReportResponse(
      LocalDate from,
      LocalDate to,
      BigDecimal total,
      List<ReportRow> byProfessional,
      List<ReportRow> byItem,
      List<ReportRow> byKind,
      List<ReportRow> byPeriod) {}

  public record LineWithoutBeneficiary(
      Long invoiceLineId,
      Long invoiceId,
      String invoiceNumber,
      Instant issuedAt,
      String description,
      String itemKind,
      BigDecimal lineTotal) {}

  public record MyEntryView(
      Long id,
      String sourceType,
      String reasonCode,
      String invoiceNumber,
      String itemName,
      String itemKind,
      String baseType,
      BigDecimal baseAmount,
      BigDecimal percentApplied,
      BigDecimal commissionAmount,
      BigDecimal fixedAmount,
      boolean fixedToProfessional,
      BigDecimal retentionAmount,
      Instant accrualAt,
      String note) {}

  public record MySummary(
      PeriodInfo currentPeriod,
      BigDecimal currentPeriodTotal,
      BigDecimal servicesTotal,
      BigDecimal productsTotal,
      List<MyEntryView> currentPeriodEntries,
      List<SettlementView> settlements,
      /* HU-COM-14 */
      BigDecimal currentPeriodRetention,
      BigDecimal currentPeriodFixed,
      boolean aguinaldoEnabled,
      BigDecimal aguinaldoBalance) {}

  public record MySettlementDetail(
      SettlementView settlement, List<MyEntryView> entries, List<Subtotal> byKind) {}

  public record OutboxStats(Map<String, Long> byStatus) {}
}
