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
      String scope, Long serviceId, Long professionalId, String value, LocalDate validUntil) {}

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
      List<VersionView> history) {}

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

  public record MatrixCell(
      Long professionalId, BigDecimal percent, String origin, boolean scheduled) {}

  public record MatrixRow(
      Long serviceId,
      String serviceName,
      String itemKind,
      BigDecimal generalPercent,
      List<MatrixCell> cells) {}

  public record MatrixProfessional(Long id, String fullName) {}

  public record MatrixResponse(
      LocalDate date, List<MatrixProfessional> professionals, List<MatrixRow> rows) {}

  public record ItemWithoutRule(Long serviceId, String serviceName, String itemKind) {}

  // ── Simulator (HU-COM-03) ─────────────────────────────────────────────────────────────────

  public record SimulateRequest(
      Long serviceId,
      Long professionalId,
      BigDecimal lineAmount,
      BigDecimal taxRate,
      BigDecimal discount,
      LocalDate date) {}

  public record SimulationResult(
      String baseType, BigDecimal baseAmount, BigDecimal commissionAmount) {}

  public record SimulateResponse(
      BigDecimal lineTotal,
      BigDecimal taxAmount,
      BigDecimal percent,
      String origin,
      String configuredBase,
      SimulationResult configured,
      SimulationResult alternative) {}

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
      Instant accrualAt,
      Long reversesEntryId,
      Long settlementId,
      String settlementStatus,
      String note) {}

  public record GenerateSettlementsRequest(
      LocalDate periodFrom, LocalDate periodTo, List<Long> professionalIds) {}

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
      Instant accrualAt,
      String note) {}

  public record MySummary(
      PeriodInfo currentPeriod,
      BigDecimal currentPeriodTotal,
      BigDecimal servicesTotal,
      BigDecimal productsTotal,
      List<MyEntryView> currentPeriodEntries,
      List<SettlementView> settlements) {}

  public record MySettlementDetail(
      SettlementView settlement, List<MyEntryView> entries, List<Subtotal> byKind) {}

  public record OutboxStats(Map<String, Long> byStatus) {}
}
