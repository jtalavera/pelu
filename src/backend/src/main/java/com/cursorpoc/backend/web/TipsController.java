package com.cursorpoc.backend.web;

import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.service.InvoiceLateTipService;
import com.cursorpoc.backend.service.TipsReportPdfService;
import com.cursorpoc.backend.service.TipsService;
import com.cursorpoc.backend.web.dto.CreateTipWithdrawalResponse;
import com.cursorpoc.backend.web.dto.InvoiceTipsResponse;
import com.cursorpoc.backend.web.dto.ManualTipMutationResponse;
import com.cursorpoc.backend.web.dto.ManualTipRequest;
import com.cursorpoc.backend.web.dto.PagedTipWithdrawalsResponse;
import com.cursorpoc.backend.web.dto.ProfessionalTipBalanceResponse;
import com.cursorpoc.backend.web.dto.TipReportResponse;
import com.cursorpoc.backend.web.dto.TipWithdrawalRequest;
import com.cursorpoc.backend.web.dto.UpdateManualTipRequest;
import com.cursorpoc.backend.web.dto.VoidLateTipRequest;
import com.cursorpoc.backend.web.dto.VoidManualTipRequest;
import jakarta.validation.Valid;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.Arrays;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/propinas")
public class TipsController {

  private static final Logger log = LoggerFactory.getLogger(TipsController.class);

  private final TipsService tipsService;
  private final TipsReportPdfService tipsReportPdfService;
  private final InvoiceLateTipService invoiceLateTipService;

  public TipsController(
      TipsService tipsService,
      TipsReportPdfService tipsReportPdfService,
      InvoiceLateTipService invoiceLateTipService) {
    this.invoiceLateTipService = invoiceLateTipService;
    this.tipsService = tipsService;
    this.tipsReportPdfService = tipsReportPdfService;
  }

  @GetMapping("/report")
  public TipReportResponse report(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @RequestParam(required = false) String from,
      @RequestParam(required = false) String to,
      @RequestParam(required = false) String professionalIds) {
    requirePrincipal(principal);
    log.info("GET /api/propinas/report tenantId={}", principal.getTenantId());
    try {
      TipReportResponse response =
          tipsService.getReport(
              principal.getTenantId(),
              parseInstant(from),
              parseInstant(to),
              parseIds(professionalIds));
      log.info(
          "GET /api/propinas/report tenantId={} status=200 rows={}",
          principal.getTenantId(),
          response.rows().size());
      return response;
    } catch (ResponseStatusException ex) {
      log.error(
          "GET /api/propinas/report tenantId={} status={}",
          principal.getTenantId(),
          ex.getStatusCode().value());
      throw ex;
    }
  }

  @GetMapping(value = "/report/pdf", produces = MediaType.APPLICATION_PDF_VALUE)
  public ResponseEntity<byte[]> reportPdf(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @RequestParam(required = false) String from,
      @RequestParam(required = false) String to,
      @RequestParam(required = false) String professionalIds) {
    requirePrincipal(principal);
    log.info("GET /api/propinas/report/pdf tenantId={}", principal.getTenantId());
    Instant fromInstant = parseInstant(from);
    Instant toInstant = parseInstant(to);
    try {
      TipReportResponse report =
          tipsService.getReport(
              principal.getTenantId(), fromInstant, toInstant, parseIds(professionalIds));
      byte[] pdf = tipsReportPdfService.render(report, fromInstant, toInstant);
      log.info("GET /api/propinas/report/pdf tenantId={} status=200", principal.getTenantId());
      return ResponseEntity.ok()
          .header(
              HttpHeaders.CONTENT_DISPOSITION,
              "inline; filename=\"" + reportFilename(fromInstant, toInstant) + "\"")
          .body(pdf);
    } catch (ResponseStatusException ex) {
      log.error(
          "GET /api/propinas/report/pdf tenantId={} status={}",
          principal.getTenantId(),
          ex.getStatusCode().value());
      throw ex;
    }
  }

  @GetMapping("/balance")
  public ProfessionalTipBalanceResponse balance(
      @AuthenticationPrincipal FemmeUserPrincipal principal, @RequestParam Long professionalId) {
    requirePrincipal(principal);
    log.info(
        "GET /api/propinas/balance tenantId={} professionalId={}",
        principal.getTenantId(),
        professionalId);
    try {
      ProfessionalTipBalanceResponse response =
          tipsService.getBalance(principal.getTenantId(), professionalId);
      log.info(
          "GET /api/propinas/balance tenantId={} professionalId={} status=200",
          principal.getTenantId(),
          professionalId);
      return response;
    } catch (ResponseStatusException ex) {
      log.error(
          "GET /api/propinas/balance tenantId={} professionalId={} status={}",
          principal.getTenantId(),
          professionalId,
          ex.getStatusCode().value());
      throw ex;
    }
  }

  @PostMapping("/withdrawals")
  public ResponseEntity<CreateTipWithdrawalResponse> createWithdrawal(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @Valid @RequestBody TipWithdrawalRequest request) {
    requirePrincipal(principal);
    log.info(
        "POST /api/propinas/withdrawals tenantId={} professionalId={}",
        principal.getTenantId(),
        request.professionalId());
    try {
      CreateTipWithdrawalResponse response =
          tipsService.createWithdrawal(
              principal.getTenantId(),
              principal.getUserId(),
              request.professionalId(),
              request.amount());
      log.info(
          "POST /api/propinas/withdrawals tenantId={} professionalId={} status=201",
          principal.getTenantId(),
          request.professionalId());
      return ResponseEntity.status(HttpStatus.CREATED).body(response);
    } catch (ResponseStatusException ex) {
      log.error(
          "POST /api/propinas/withdrawals tenantId={} professionalId={} status={}",
          principal.getTenantId(),
          request.professionalId(),
          ex.getStatusCode().value());
      throw ex;
    }
  }

  @GetMapping("/withdrawals")
  public PagedTipWithdrawalsResponse withdrawals(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @RequestParam(required = false) Long professionalId,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "10") int size) {
    requirePrincipal(principal);
    log.info(
        "GET /api/propinas/withdrawals tenantId={} professionalId={} page={} size={}",
        principal.getTenantId(),
        professionalId,
        page,
        size);
    try {
      PagedTipWithdrawalsResponse response =
          tipsService.listWithdrawals(principal.getTenantId(), professionalId, page, size);
      log.info(
          "GET /api/propinas/withdrawals tenantId={} professionalId={} status=200",
          principal.getTenantId(),
          professionalId);
      return response;
    } catch (ResponseStatusException ex) {
      log.error(
          "GET /api/propinas/withdrawals tenantId={} professionalId={} status={}",
          principal.getTenantId(),
          professionalId,
          ex.getStatusCode().value());
      throw ex;
    }
  }

  /**
   * Manual tips: only the salon administrator may load, edit or void them. Every call is recorded
   * in the audit trail by {@code AuditLogFilter} (who, which endpoint, which record).
   */
  @PostMapping("/manual")
  public ResponseEntity<ManualTipMutationResponse> createManualTip(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @Valid @RequestBody ManualTipRequest request) {
    requireAdmin(principal);
    log.info(
        "POST /api/propinas/manual tenantId={} professionalId={}",
        principal.getTenantId(),
        request.professionalId());
    try {
      ManualTipMutationResponse response =
          tipsService.createManualTip(
              principal.getTenantId(),
              principal.getUserId(),
              request.professionalId(),
              request.amount(),
              request.tippedAt(),
              request.note());
      log.info("POST /api/propinas/manual tenantId={} status=201", principal.getTenantId());
      return ResponseEntity.status(HttpStatus.CREATED).body(response);
    } catch (ResponseStatusException ex) {
      log.error(
          "POST /api/propinas/manual tenantId={} status={}",
          principal.getTenantId(),
          ex.getStatusCode().value());
      throw ex;
    }
  }

  @PutMapping("/manual/{id}")
  public ManualTipMutationResponse updateManualTip(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @PathVariable Long id,
      @RequestBody UpdateManualTipRequest request) {
    requireAdmin(principal);
    log.info("PUT /api/propinas/manual/{} tenantId={}", id, principal.getTenantId());
    try {
      ManualTipMutationResponse response =
          tipsService.updateManualTip(
              principal.getTenantId(),
              principal.getUserId(),
              id,
              request.amount(),
              request.tippedAt(),
              request.note());
      log.info("PUT /api/propinas/manual/{} tenantId={} status=200", id, principal.getTenantId());
      return response;
    } catch (ResponseStatusException ex) {
      log.error(
          "PUT /api/propinas/manual/{} tenantId={} status={}",
          id,
          principal.getTenantId(),
          ex.getStatusCode().value());
      throw ex;
    }
  }

  @PostMapping("/manual/{id}/void")
  public ManualTipMutationResponse voidManualTip(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @PathVariable Long id,
      @RequestBody VoidManualTipRequest request) {
    requireAdmin(principal);
    log.info("POST /api/propinas/manual/{}/void tenantId={}", id, principal.getTenantId());
    try {
      ManualTipMutationResponse response =
          tipsService.voidManualTip(
              principal.getTenantId(), principal.getUserId(), id, request.reason());
      log.info(
          "POST /api/propinas/manual/{}/void tenantId={} status=200", id, principal.getTenantId());
      return response;
    } catch (ResponseStatusException ex) {
      log.error(
          "POST /api/propinas/manual/{}/void tenantId={} status={}",
          id,
          principal.getTenantId(),
          ex.getStatusCode().value());
      throw ex;
    }
  }

  /**
   * Voids a tip left after the invoice was issued (admin only, with a reason). It stops counting in
   * the professional's balance and in the cash register it entered; the invoice's tips are returned
   * updated.
   */
  @PostMapping("/late/{id}/void")
  public InvoiceTipsResponse voidLateTip(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @PathVariable Long id,
      @RequestBody VoidLateTipRequest request) {
    requireAdmin(principal);
    log.info("POST /api/propinas/late/{}/void tenantId={}", id, principal.getTenantId());
    try {
      InvoiceTipsResponse response =
          invoiceLateTipService.voidTip(
              principal.getTenantId(), principal.getUserId(), id, request.reason());
      log.info(
          "POST /api/propinas/late/{}/void tenantId={} status=200", id, principal.getTenantId());
      return response;
    } catch (ResponseStatusException ex) {
      log.error(
          "POST /api/propinas/late/{}/void tenantId={} status={}",
          id,
          principal.getTenantId(),
          ex.getStatusCode().value());
      throw ex;
    }
  }

  private static Instant parseInstant(String value) {
    return value != null && !value.isBlank() ? Instant.parse(value) : null;
  }

  private static List<Long> parseIds(String csv) {
    if (csv == null || csv.isBlank()) {
      return null;
    }
    return Arrays.stream(csv.split(",")).map(String::trim).map(Long::parseLong).toList();
  }

  private static String reportFilename(Instant from, Instant to) {
    DateTimeFormatter fmt = DateTimeFormatter.ofPattern("yyyyMMdd");
    String fromLabel = from != null ? fmt.withZone(ZoneOffset.UTC).format(from) : "inicio";
    String toLabel = to != null ? fmt.withZone(ZoneOffset.UTC).format(to) : "hoy";
    return "PROPINAS-" + fromLabel + "-" + toLabel + ".pdf";
  }

  private static void requireAdmin(FemmeUserPrincipal principal) {
    requirePrincipal(principal);
    if (!principal.isAdmin()) {
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "FORBIDDEN");
    }
  }

  private static void requirePrincipal(FemmeUserPrincipal principal) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
  }
}
