package com.cursorpoc.backend.service;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.AuditLog;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.repository.AuditLogRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.web.dto.AuditLogResponse;
import com.cursorpoc.backend.web.dto.PageResponse;
import java.time.Instant;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Issue #284: the audit trail ("quién hizo qué"). {@link #record} is called by {@code
 * AuditLogFilter} for every successful data-changing API call; {@link #search} backs the
 * "Auditoría" screens (salon administrator: own tenant only; platform root: every tenant).
 */
@Service
public class AuditLogService {

  private static final Logger log = LoggerFactory.getLogger(AuditLogService.class);

  /** Largest page a client may ask for. */
  static final int MAX_PAGE_SIZE = 100;

  private static final Set<String> MUTATING_METHODS = Set.of("POST", "PUT", "PATCH", "DELETE");

  /**
   * Endpoints that are never audited: authentication (no user yet / token plumbing), machine
   * callers, e2e test support, and housekeeping that changes no business data.
   */
  private static final List<String> EXCLUDED_PREFIXES =
      List.of(
          "/api/auth/",
          "/api/integration",
          "/api/admin/seed",
          "/api/whatsapp/webhook",
          "/api/me/tour-state",
          "/api/sso/");

  /** Routing prefixes that say who may call, not what is touched: skipped to find the resource. */
  private static final Set<String> PREFIX_SEGMENTS = Set.of("platform", "admin");

  private final AuditLogRepository auditLogRepository;
  private final TenantRepository tenantRepository;
  private final FemmeTimeProperties timeProperties;

  public AuditLogService(
      AuditLogRepository auditLogRepository,
      TenantRepository tenantRepository,
      FemmeTimeProperties timeProperties) {
    this.auditLogRepository = auditLogRepository;
    this.tenantRepository = tenantRepository;
    this.timeProperties = timeProperties;
  }

  /** Whether a call to {@code pattern} with {@code method} is part of the audit trail. */
  public static boolean isAuditable(String method, String pattern) {
    if (method == null || pattern == null || !MUTATING_METHODS.contains(method.toUpperCase())) {
      return false;
    }
    if (!pattern.startsWith("/api/")) {
      return false;
    }
    if (pattern.contains("-test-support") || pattern.endsWith("/validate-headers")) {
      return false;
    }
    return EXCLUDED_PREFIXES.stream().noneMatch(pattern::startsWith);
  }

  /**
   * Splits {@code /api/invoices/{id}/void} into resource {@code invoices} and operation {@code
   * void}; the first literal segment after {@code /api} (skipping a {@code platform}/{@code admin}
   * routing prefix) is the resource, and a trailing literal segment after it is the operation.
   */
  static String[] resourceAndOperation(String pattern) {
    String[] parts = pattern.replaceFirst("^/api/?", "").split("/");
    List<String> literals =
        java.util.Arrays.stream(parts).filter(p -> !p.isBlank() && !p.startsWith("{")).toList();
    int start = literals.size() > 1 && PREFIX_SEGMENTS.contains(literals.get(0)) ? 1 : 0;
    if (literals.size() <= start) {
      return new String[] {literals.isEmpty() ? "api" : literals.get(0), null};
    }
    String resource = literals.get(start);
    String last = literals.get(literals.size() - 1);
    // The operation is the last literal only when the URL ends with it ("…/{id}/void"), so that
    // "/api/clients/{id}" (PUT) has none, and "/api/professionals/{id}/schedules" reads
    // "schedules".
    boolean endsWithLiteral = !parts[parts.length - 1].startsWith("{");
    String operation =
        literals.size() - start > 1 && endsWithLiteral && !last.equals(resource) ? last : null;
    return new String[] {resource, operation};
  }

  /**
   * Records one call. Never throws: auditing must not break (or even slow down failing) the request
   * it describes. Runs in its own transaction so a rollback of the request's does not erase it, and
   * vice-versa.
   */
  @Transactional(propagation = Propagation.REQUIRES_NEW)
  public void record(
      FemmeUserPrincipal principal,
      String method,
      String pattern,
      String entityId,
      int statusCode) {
    try {
      String[] ro = resourceAndOperation(pattern);
      AuditLog row = new AuditLog();
      row.setTenantId(principal.getTenantIdOrNull());
      row.setUserId(principal.getUserId());
      row.setUserEmail(principal.getUsername());
      row.setUserRole(principal.getRole() != null ? principal.getRole().name() : null);
      row.setHttpMethod(method.toUpperCase());
      row.setResource(truncate(ro[0], 64));
      row.setOperation(truncate(ro[1], 64));
      row.setPathPattern(truncate(pattern, 255));
      row.setEntityId(truncate(entityId, 64));
      row.setStatusCode(statusCode);
      row.setCreatedAt(Instant.now());
      auditLogRepository.save(row);
    } catch (RuntimeException e) {
      log.error("audit: could not record {} {} ({})", method, pattern, e.toString());
    }
  }

  @Transactional(readOnly = true)
  public PageResponse<AuditLogResponse> search(
      Long tenantId, String from, String to, String resource, String q, int page, int size) {
    Instant fromInstant = parseDayStart(from);
    // "to" is a calendar day, inclusive: everything before the start of the next day.
    Instant toInstant = parseDayStart(to) == null ? null : parseDayStart(to).plusSeconds(86_400);
    if (fromInstant != null && toInstant != null && !fromInstant.isBefore(toInstant)) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_DATE_RANGE");
    }
    int safeSize = Math.min(Math.max(size, 1), MAX_PAGE_SIZE);
    Page<AuditLog> result =
        auditLogRepository.search(
            tenantId,
            fromInstant,
            toInstant,
            blankToNull(resource),
            blankToNull(q),
            PageRequest.of(Math.max(page, 0), safeSize));

    Map<Long, String> tenantNames = new HashMap<>();
    List<AuditLogResponse> content =
        result.getContent().stream()
            .map(
                a ->
                    new AuditLogResponse(
                        a.getId(),
                        a.getTenantId(),
                        a.getTenantId() == null
                            ? null
                            : tenantNames.computeIfAbsent(a.getTenantId(), this::tenantName),
                        a.getUserEmail(),
                        a.getUserRole(),
                        a.getHttpMethod(),
                        a.getResource(),
                        a.getOperation(),
                        a.getEntityId(),
                        a.getStatusCode(),
                        a.getCreatedAt()))
            .toList();
    return new PageResponse<>(
        content,
        result.getNumber(),
        result.getSize(),
        result.getTotalElements(),
        result.getTotalPages());
  }

  private String tenantName(Long tenantId) {
    return tenantRepository.findById(tenantId).map(Tenant::getName).orElse(null);
  }

  /** {@code yyyy-MM-dd} → that day's 00:00 in the business timezone, as an instant. */
  private Instant parseDayStart(String day) {
    if (day == null || day.isBlank()) {
      return null;
    }
    try {
      return LocalDate.parse(day.trim()).atStartOfDay(timeProperties.zoneId()).toInstant();
    } catch (DateTimeParseException e) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_DATE_RANGE");
    }
  }

  private static String blankToNull(String s) {
    return s == null || s.isBlank() ? null : s.trim();
  }

  private static String truncate(String s, int max) {
    return s == null || s.length() <= max ? s : s.substring(0, max);
  }
}
