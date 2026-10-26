package com.cursorpoc.backend.web;

import com.cursorpoc.backend.commission.CommissionAccess;
import com.cursorpoc.backend.commission.CommissionConfigService;
import com.cursorpoc.backend.commission.CommissionExportService;
import com.cursorpoc.backend.commission.CommissionQueryService;
import com.cursorpoc.backend.commission.CommissionReassignmentService;
import com.cursorpoc.backend.commission.CommissionSettlementService;
import com.cursorpoc.backend.domain.CommissionSettlement;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.web.dto.CommissionDtos.AdjustmentRequest;
import com.cursorpoc.backend.web.dto.CommissionDtos.ApplyChangesRequest;
import com.cursorpoc.backend.web.dto.CommissionDtos.ApplyChangesResponse;
import com.cursorpoc.backend.web.dto.CommissionDtos.ApplyModeOptions;
import com.cursorpoc.backend.web.dto.CommissionDtos.AssignInvoiceLinesRequest;
import com.cursorpoc.backend.web.dto.CommissionDtos.AssignLineRequest;
import com.cursorpoc.backend.web.dto.CommissionDtos.EntryView;
import com.cursorpoc.backend.web.dto.CommissionDtos.GenerateSettlementsRequest;
import com.cursorpoc.backend.web.dto.CommissionDtos.ItemRulesResponse;
import com.cursorpoc.backend.web.dto.CommissionDtos.ItemWithoutRule;
import com.cursorpoc.backend.web.dto.CommissionDtos.LineWithoutBeneficiary;
import com.cursorpoc.backend.web.dto.CommissionDtos.MySettlementDetail;
import com.cursorpoc.backend.web.dto.CommissionDtos.MySummary;
import com.cursorpoc.backend.web.dto.CommissionDtos.PagedSettlements;
import com.cursorpoc.backend.web.dto.CommissionDtos.PayRequest;
import com.cursorpoc.backend.web.dto.CommissionDtos.ReassignRequest;
import com.cursorpoc.backend.web.dto.CommissionDtos.ReportResponse;
import com.cursorpoc.backend.web.dto.CommissionDtos.RulesView;
import com.cursorpoc.backend.web.dto.CommissionDtos.SettingsResponse;
import com.cursorpoc.backend.web.dto.CommissionDtos.SettlementDetail;
import com.cursorpoc.backend.web.dto.CommissionDtos.SettlementPreview;
import com.cursorpoc.backend.web.dto.CommissionDtos.SettlementView;
import com.cursorpoc.backend.web.dto.CommissionDtos.VoidSettlementRequest;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/** Módulo de comisiones API (HU-COM-01..11). ADMIN endpoints plus the professional's own view. */
@RestController
@RequestMapping("/api/commissions")
public class CommissionController {

  private static final Logger log = LoggerFactory.getLogger(CommissionController.class);

  private final CommissionAccess access;
  private final CommissionConfigService configService;
  private final CommissionSettlementService settlementService;
  private final CommissionQueryService queryService;
  private final CommissionExportService exportService;
  private final CommissionReassignmentService reassignmentService;

  public CommissionController(
      CommissionAccess access,
      CommissionConfigService configService,
      CommissionSettlementService settlementService,
      CommissionQueryService queryService,
      CommissionExportService exportService,
      CommissionReassignmentService reassignmentService) {
    this.access = access;
    this.configService = configService;
    this.settlementService = settlementService;
    this.queryService = queryService;
    this.exportService = exportService;
    this.reassignmentService = reassignmentService;
  }

  // ── Configuration & rules ─────────────────────────────────────────────────────────────────

  @GetMapping("/settings")
  public SettingsResponse settings(@AuthenticationPrincipal FemmeUserPrincipal p) {
    return admin(
        p, "GET", "/api/commissions/settings", () -> configService.settings(p.getTenantId()));
  }

  @GetMapping("/apply-mode-options")
  public ApplyModeOptions applyModeOptions(@AuthenticationPrincipal FemmeUserPrincipal p) {
    return admin(
        p,
        "GET",
        "/api/commissions/apply-mode-options",
        () -> configService.applyModeOptions(p.getTenantId()));
  }

  @PostMapping("/changes")
  public ApplyChangesResponse applyChanges(
      @AuthenticationPrincipal FemmeUserPrincipal p, @RequestBody ApplyChangesRequest request) {
    return admin(
        p,
        "POST",
        "/api/commissions/changes",
        () -> configService.applyChanges(p.getTenantId(), p.getUsername(), request));
  }

  @DeleteMapping("/changes/{versionId}")
  public ResponseEntity<Void> cancelScheduled(
      @AuthenticationPrincipal FemmeUserPrincipal p, @PathVariable long versionId) {
    return admin(
        p,
        "DELETE",
        "/api/commissions/changes/" + versionId,
        () -> {
          configService.cancelScheduled(p.getTenantId(), versionId, p.getUsername());
          return ResponseEntity.noContent().build();
        });
  }

  @GetMapping("/items/{serviceId}/rules")
  public ItemRulesResponse itemRules(
      @AuthenticationPrincipal FemmeUserPrincipal p, @PathVariable long serviceId) {
    return admin(
        p,
        "GET",
        "/api/commissions/items/" + serviceId + "/rules",
        () -> configService.itemRules(p.getTenantId(), serviceId));
  }

  @GetMapping("/rules-view")
  public RulesView rulesView(
      @AuthenticationPrincipal FemmeUserPrincipal p,
      @RequestParam(required = false) String kind,
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE)
          LocalDate date) {
    return admin(
        p,
        "GET",
        "/api/commissions/rules-view",
        () -> configService.rulesView(p.getTenantId(), kind, date));
  }

  @GetMapping("/items-without-rule")
  public List<ItemWithoutRule> itemsWithoutRule(@AuthenticationPrincipal FemmeUserPrincipal p) {
    return admin(
        p,
        "GET",
        "/api/commissions/items-without-rule",
        () -> configService.itemsWithoutGeneralRule(p.getTenantId()));
  }

  /** Replaces the simulator: what the professional would be paid today for an open period. */
  @GetMapping("/settlement-preview")
  public SettlementPreview settlementPreview(
      @AuthenticationPrincipal FemmeUserPrincipal p,
      @RequestParam long professionalId,
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
    return admin(
        p,
        "GET",
        "/api/commissions/settlement-preview",
        () -> queryService.settlementPreview(p.getTenantId(), professionalId, from, to));
  }

  /** Change the professional who earns a commission (wrong assignment at billing). */
  @PostMapping("/entries/{id}/reassign")
  public EntryView reassign(
      @AuthenticationPrincipal FemmeUserPrincipal p,
      @PathVariable long id,
      @RequestBody ReassignRequest request) {
    return admin(
        p,
        "POST",
        "/api/commissions/entries/" + id + "/reassign",
        () -> {
          var saved = reassignmentService.reassign(p.getTenantId(), id, p.getUsername(), request);
          return queryService.entryView(
              saved, configService.professionalNames(p.getTenantId()), null, java.util.Set.of());
        });
  }

  /** HU-COM-13: assign a professional to an issued line that was billed without one. */
  @PostMapping("/invoice-lines/{lineId}/assign")
  public EntryView assignLine(
      @AuthenticationPrincipal FemmeUserPrincipal p,
      @PathVariable long lineId,
      @RequestBody AssignLineRequest request) {
    return admin(
        p,
        "POST",
        "/api/commissions/invoice-lines/" + lineId + "/assign",
        () -> {
          var saved =
              reassignmentService.assignLine(p.getTenantId(), lineId, p.getUsername(), request);
          return queryService.entryView(
              saved, configService.professionalNames(p.getTenantId()), null, java.util.Set.of());
        });
  }

  /** "Asignar profesional" from the comprobante detail: several lines of one invoice at once. */
  @PostMapping("/invoices/{invoiceId}/assign-lines")
  public List<EntryView> assignInvoiceLines(
      @AuthenticationPrincipal FemmeUserPrincipal p,
      @PathVariable long invoiceId,
      @RequestBody AssignInvoiceLinesRequest request) {
    return admin(
        p,
        "POST",
        "/api/commissions/invoices/" + invoiceId + "/assign-lines",
        () -> {
          var saved =
              reassignmentService.assignInvoiceLines(
                  p.getTenantId(), invoiceId, p.getUsername(), request);
          var names = configService.professionalNames(p.getTenantId());
          return saved.stream()
              .map(e -> queryService.entryView(e, names, null, java.util.Set.of()))
              .toList();
        });
  }

  // ── Entries & reports ─────────────────────────────────────────────────────────────────────

  @GetMapping("/entries")
  public List<EntryView> entries(
      @AuthenticationPrincipal FemmeUserPrincipal p,
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
      @RequestParam(required = false) Long professionalId,
      @RequestParam(required = false) String kind,
      @RequestParam(required = false) String state) {
    return admin(
        p,
        "GET",
        "/api/commissions/entries",
        () -> queryService.entries(p.getTenantId(), from, to, professionalId, kind, state));
  }

  @GetMapping(value = "/entries.csv", produces = "text/csv")
  public ResponseEntity<byte[]> entriesCsv(
      @AuthenticationPrincipal FemmeUserPrincipal p,
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
      @RequestParam(required = false) Long professionalId,
      @RequestParam(required = false) String kind,
      @RequestParam(required = false) String state) {
    return admin(
        p,
        "GET",
        "/api/commissions/entries.csv",
        () ->
            csv(
                "comisiones.csv",
                exportService.entriesCsv(
                    queryService.entries(p.getTenantId(), from, to, professionalId, kind, state))));
  }

  @GetMapping("/reports")
  public ReportResponse report(
      @AuthenticationPrincipal FemmeUserPrincipal p,
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
      @RequestParam(required = false) Long professionalId,
      @RequestParam(required = false) String kind,
      @RequestParam(required = false) String state) {
    return admin(
        p,
        "GET",
        "/api/commissions/reports",
        () -> queryService.report(p.getTenantId(), from, to, professionalId, kind, state));
  }

  @GetMapping("/lines-without-beneficiary")
  public List<LineWithoutBeneficiary> linesWithoutBeneficiary(
      @AuthenticationPrincipal FemmeUserPrincipal p,
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
    return admin(
        p,
        "GET",
        "/api/commissions/lines-without-beneficiary",
        () -> queryService.linesWithoutBeneficiary(p.getTenantId(), from, to));
  }

  // ── Settlements ───────────────────────────────────────────────────────────────────────────

  @GetMapping("/settlements")
  public PagedSettlements settlements(
      @AuthenticationPrincipal FemmeUserPrincipal p,
      @RequestParam(required = false) Long professionalId,
      @RequestParam(required = false) String status,
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "20") int size) {
    return admin(
        p,
        "GET",
        "/api/commissions/settlements",
        () ->
            queryService.listSettlements(
                p.getTenantId(), professionalId, status, from, to, page, size));
  }

  @GetMapping(value = "/settlements.csv", produces = "text/csv")
  public ResponseEntity<byte[]> settlementsCsv(
      @AuthenticationPrincipal FemmeUserPrincipal p,
      @RequestParam(required = false) Long professionalId,
      @RequestParam(required = false) String status) {
    return admin(
        p,
        "GET",
        "/api/commissions/settlements.csv",
        () ->
            csv(
                "liquidaciones.csv",
                exportService.settlementsCsv(
                    queryService
                        .listSettlements(
                            p.getTenantId(), professionalId, status, null, null, 0, 100)
                        .items())));
  }

  @PostMapping("/settlements/generate")
  public List<SettlementView> generate(
      @AuthenticationPrincipal FemmeUserPrincipal p,
      @RequestBody GenerateSettlementsRequest request) {
    return admin(
        p,
        "POST",
        "/api/commissions/settlements/generate",
        () -> views(p, settlementService.generate(p.getTenantId(), p.getUsername(), request)));
  }

  @GetMapping("/settlements/{id}")
  public SettlementDetail settlement(
      @AuthenticationPrincipal FemmeUserPrincipal p, @PathVariable long id) {
    return admin(
        p,
        "GET",
        "/api/commissions/settlements/" + id,
        () -> queryService.settlementDetail(p.getTenantId(), id));
  }

  @GetMapping(value = "/settlements/{id}/pdf", produces = MediaType.APPLICATION_PDF_VALUE)
  public ResponseEntity<byte[]> settlementPdf(
      @AuthenticationPrincipal FemmeUserPrincipal p, @PathVariable long id) {
    return admin(
        p,
        "GET",
        "/api/commissions/settlements/" + id + "/pdf",
        () ->
            ResponseEntity.ok()
                .header(
                    HttpHeaders.CONTENT_DISPOSITION,
                    "inline; filename=\"liquidacion-" + id + ".pdf\"")
                .contentType(MediaType.APPLICATION_PDF)
                .body(
                    exportService.settlementPdf(
                        p.getTenantId(), queryService.settlementDetail(p.getTenantId(), id))));
  }

  @PostMapping("/settlements/{id}/adjustments")
  public SettlementDetail addAdjustment(
      @AuthenticationPrincipal FemmeUserPrincipal p,
      @PathVariable long id,
      @RequestBody AdjustmentRequest request) {
    return admin(
        p,
        "POST",
        "/api/commissions/settlements/" + id + "/adjustments",
        () -> {
          settlementService.addAdjustment(p.getTenantId(), id, p.getUsername(), request);
          return queryService.settlementDetail(p.getTenantId(), id);
        });
  }

  @PostMapping("/settlements/{id}/approve")
  public SettlementDetail approve(
      @AuthenticationPrincipal FemmeUserPrincipal p, @PathVariable long id) {
    return admin(
        p,
        "POST",
        "/api/commissions/settlements/" + id + "/approve",
        () -> {
          settlementService.approve(p.getTenantId(), id, p.getUsername());
          return queryService.settlementDetail(p.getTenantId(), id);
        });
  }

  @PostMapping("/settlements/{id}/pay")
  public SettlementDetail pay(
      @AuthenticationPrincipal FemmeUserPrincipal p,
      @PathVariable long id,
      @RequestBody PayRequest request) {
    return admin(
        p,
        "POST",
        "/api/commissions/settlements/" + id + "/pay",
        () -> {
          settlementService.pay(p.getTenantId(), id, p.getUsername(), request);
          return queryService.settlementDetail(p.getTenantId(), id);
        });
  }

  @PostMapping("/settlements/{id}/void")
  public SettlementDetail voidSettlement(
      @AuthenticationPrincipal FemmeUserPrincipal p,
      @PathVariable long id,
      @RequestBody VoidSettlementRequest request) {
    return admin(
        p,
        "POST",
        "/api/commissions/settlements/" + id + "/void",
        () -> {
          settlementService.voidSettlement(
              p.getTenantId(), id, p.getUsername(), request == null ? null : request.reason());
          return queryService.settlementDetail(p.getTenantId(), id);
        });
  }

  // ── Professional's own view (HU-COM-07) ───────────────────────────────────────────────────

  @GetMapping("/me")
  public MySummary me(@AuthenticationPrincipal FemmeUserPrincipal p) {
    return logged(
        p,
        "GET",
        "/api/commissions/me",
        () -> queryService.mySummary(p.getTenantId(), access.requireProfessional(p)));
  }

  @GetMapping("/me/settlements/{id}")
  public MySettlementDetail mySettlement(
      @AuthenticationPrincipal FemmeUserPrincipal p, @PathVariable long id) {
    return logged(
        p,
        "GET",
        "/api/commissions/me/settlements/" + id,
        () -> queryService.mySettlement(p.getTenantId(), access.requireProfessional(p), id));
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────────────────

  private List<SettlementView> views(FemmeUserPrincipal p, List<CommissionSettlement> settlements) {
    Map<Long, String> names = configService.professionalNames(p.getTenantId());
    return settlements.stream().map(s -> queryService.view(s, names)).toList();
  }

  private static ResponseEntity<byte[]> csv(String filename, byte[] body) {
    return ResponseEntity.ok()
        .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + filename + "\"")
        .contentType(new MediaType("text", "csv", java.nio.charset.StandardCharsets.UTF_8))
        .body(body);
  }

  private <T> T admin(FemmeUserPrincipal p, String method, String path, Supplier<T> action) {
    return logged(
        p,
        method,
        path,
        () -> {
          access.requireAdmin(p);
          return action.get();
        });
  }

  /** CLAUDE.md: INFO on request and response (path, method, tenant); ERROR for non-2xx. */
  private static <T> T logged(
      FemmeUserPrincipal p, String method, String path, Supplier<T> action) {
    Long tenantId = p == null ? null : p.getTenantIdOrNull();
    log.info("{} {} tenantId={}", method, path, tenantId);
    try {
      T result = action.get();
      log.info("{} {} tenantId={} status=200", method, path, tenantId);
      return result;
    } catch (ResponseStatusException ex) {
      log.error(
          "{} {} tenantId={} status={} error={}",
          method,
          path,
          tenantId,
          ex.getStatusCode().value(),
          ex.getReason());
      throw ex;
    } catch (RuntimeException ex) {
      log.error("{} {} tenantId={} status=500", method, path, tenantId, ex);
      throw ex;
    }
  }
}
