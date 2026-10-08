package com.cursorpoc.backend.web;

import com.cursorpoc.backend.config.SifenConnectionProperties;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.service.SifenCertificateService;
import com.cursorpoc.backend.service.SifenCscService;
import com.cursorpoc.backend.web.dto.SifenCertificateResponse;
import com.cursorpoc.backend.web.dto.SifenCertificateUploadRequest;
import com.cursorpoc.backend.web.dto.SifenCscResponse;
import com.cursorpoc.backend.web.dto.SifenCscSaveRequest;
import jakarta.validation.Valid;
import java.util.List;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * SIFEN credentials of a tenant — its digital certificate and its CSC — managed ONLY by the
 * platform's root user ({@code PLATFORM_ADMIN}), never by the salon's own administrator. They are
 * the taxpayer's fiscal credentials (issued by the DNIT / a certification authority to the business
 * and bound to the whole electronic-invoicing setup), so loading or rotating them is a support
 * operation done by the platform on the salon's behalf. The tenant administrator keeps a read-only
 * view ({@code GET /api/sifen/certificates}, {@code GET /api/sifen/csc}).
 *
 * <p>Every endpoint takes the target tenant explicitly in the path and is refused (403) for any
 * other role. Secrets are write-only: no response ever carries the .p12, its password or a CSC.
 */
@RestController
@RequestMapping("/api/platform/tenants/{tenantId}/sifen")
public class PlatformSifenController {

  private static final Logger log = LoggerFactory.getLogger(PlatformSifenController.class);

  private final TenantRepository tenantRepository;
  private final SifenCertificateService certificateService;
  private final SifenCscService cscService;
  private final SifenConnectionProperties connectionProperties;

  public PlatformSifenController(
      TenantRepository tenantRepository,
      SifenCertificateService certificateService,
      SifenCscService cscService,
      SifenConnectionProperties connectionProperties) {
    this.tenantRepository = tenantRepository;
    this.certificateService = certificateService;
    this.cscService = cscService;
    this.connectionProperties = connectionProperties;
  }

  /**
   * Which tenant a SIFEN setup screen is for (name only — no fiscal data) and the SIFEN environment
   * the platform runs against (the root user has no tenant, so it cannot use the tenant-scoped
   * {@code /api/sifen/environment}).
   */
  public record TenantSifenInfo(long tenantId, String tenantName, String environment) {}

  @GetMapping
  public TenantSifenInfo info(
      @AuthenticationPrincipal FemmeUserPrincipal principal, @PathVariable long tenantId) {
    return run(
        principal,
        "GET /api/platform/tenants/{}/sifen",
        tenantId,
        () -> {
          Tenant tenant = requireTenant(tenantId);
          return new TenantSifenInfo(
              tenant.getId(), tenant.getName(), connectionProperties.activeEnvironment().name());
        });
  }

  @GetMapping("/certificates")
  public List<SifenCertificateResponse> listCertificates(
      @AuthenticationPrincipal FemmeUserPrincipal principal, @PathVariable long tenantId) {
    return run(
        principal,
        "GET /api/platform/tenants/{}/sifen/certificates",
        tenantId,
        () -> {
          requireTenant(tenantId);
          return certificateService.list(tenantId);
        });
  }

  @PostMapping("/certificates")
  public SifenCertificateResponse uploadCertificate(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @PathVariable long tenantId,
      @Valid @RequestBody SifenCertificateUploadRequest request) {
    return run(
        principal,
        "POST /api/platform/tenants/{}/sifen/certificates",
        tenantId,
        () -> certificateService.upload(tenantId, principal.getUserId(), request));
  }

  @GetMapping("/csc")
  public List<SifenCscResponse> listCsc(
      @AuthenticationPrincipal FemmeUserPrincipal principal, @PathVariable long tenantId) {
    return run(
        principal,
        "GET /api/platform/tenants/{}/sifen/csc",
        tenantId,
        () -> {
          requireTenant(tenantId);
          return cscService.list(tenantId);
        });
  }

  @PostMapping("/csc")
  public SifenCscResponse saveCsc(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @PathVariable long tenantId,
      @Valid @RequestBody SifenCscSaveRequest request) {
    return run(
        principal,
        "POST /api/platform/tenants/{}/sifen/csc",
        tenantId,
        () -> cscService.save(tenantId, principal.getUserId(), request));
  }

  @PostMapping("/csc/{idCsc}/activate")
  public SifenCscResponse activateCsc(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @PathVariable long tenantId,
      @PathVariable int idCsc) {
    return run(
        principal,
        "POST /api/platform/tenants/{}/sifen/csc/" + idCsc + "/activate",
        tenantId,
        () -> cscService.activate(tenantId, principal.getUserId(), idCsc));
  }

  private Tenant requireTenant(long tenantId) {
    return tenantRepository
        .findById(tenantId)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "TENANT_NOT_FOUND"));
  }

  private static <T> T run(
      FemmeUserPrincipal principal, String route, long tenantId, Supplier<T> action) {
    if (principal == null) {
      log.error("{} status=401", route.replace("{}", String.valueOf(tenantId)));
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    String path = route.replace("{}", String.valueOf(tenantId));
    if (principal.getRole() != UserRole.PLATFORM_ADMIN) {
      log.error("{} status=403 role={}", path, principal.getRole());
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "FORBIDDEN");
    }
    log.info(
        "{} method={} tenantId={} adminUserId={}",
        path,
        path.split(" ")[0],
        tenantId,
        principal.getUserId());
    try {
      T result = action.get();
      log.info("{} tenantId={} status=200", path, tenantId);
      return result;
    } catch (ResponseStatusException ex) {
      log.error(
          "{} tenantId={} status={} error={}",
          path,
          tenantId,
          ex.getStatusCode().value(),
          ex.getReason());
      throw ex;
    }
  }
}
