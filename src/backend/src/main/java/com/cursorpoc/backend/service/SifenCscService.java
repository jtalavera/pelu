package com.cursorpoc.backend.service;

import com.cursorpoc.backend.config.SifenConnectionProperties;
import com.cursorpoc.backend.config.SifenQrProperties;
import com.cursorpoc.backend.domain.SifenCsc;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.repository.SifenCscRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.web.dto.SifenCscResponse;
import com.cursorpoc.backend.web.dto.SifenCscSaveRequest;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Per-tenant CSC (Código de Seguridad del Contribuyente). The DNIT issues each taxpayer its own CSC
 * and validates every QR hash with it, so every tenant loads and uses its own — Manual Técnico V150
 * sección 13.8.1. Values live in the {@link SifenCscSecretStore}; the database only keeps the IdCSC
 * and a pointer. The value is never returned by the API and never logged.
 *
 * <p><b>Which CSC signs a QR</b> ({@link #resolveActive}): the tenant's active one. With none
 * configured, the SET's public <i>test</i> CSC ({@link SifenQrProperties}) is used in the TEST
 * environment — so homologation and demos keep working — but in PRODUCTION it fails with {@code
 * SIFEN_CSC_NOT_CONFIGURED}: a QR hashed with a test CSC would be rejected by the DNIT, so it is
 * never silently substituted.
 */
@Service
public class SifenCscService {

  private static final Logger log = LoggerFactory.getLogger(SifenCscService.class);

  /** The DNIT's CSC is 32 alphanumeric characters (manual §13.8.1). */
  private static final Pattern CSC_FORMAT = Pattern.compile("^[A-Za-z0-9]{32}$");

  static final int MIN_ID_CSC = 1;
  static final int MAX_ID_CSC = 9999;

  private final SifenCscRepository cscRepository;
  private final SifenCscSecretStore secretStore;
  private final TenantRepository tenantRepository;
  private final SifenQrProperties qrProperties;
  private final SifenConnectionProperties connectionProperties;

  public SifenCscService(
      SifenCscRepository cscRepository,
      SifenCscSecretStore secretStore,
      TenantRepository tenantRepository,
      SifenQrProperties qrProperties,
      SifenConnectionProperties connectionProperties) {
    this.cscRepository = cscRepository;
    this.secretStore = secretStore;
    this.tenantRepository = tenantRepository;
    this.qrProperties = qrProperties;
    this.connectionProperties = connectionProperties;
  }

  @Transactional(readOnly = true)
  public List<SifenCscResponse> list(long tenantId) {
    return cscRepository.findByTenant_IdOrderByIdCscAsc(tenantId).stream()
        .map(SifenCscService::toResponse)
        .toList();
  }

  /**
   * Adds a CSC, or replaces the value of one the tenant already has under the same {@code idCsc}
   * (the DNIT can reissue a code). The tenant's first CSC becomes active automatically; later ones
   * stay inactive until {@link #activate} — adding one must never silently change which code signs
   * the QRs.
   */
  @Transactional
  public SifenCscResponse save(long tenantId, long userId, SifenCscSaveRequest request) {
    int idCsc = validateIdCsc(request.idCsc());
    String value = validateCsc(request.csc());

    Tenant tenant =
        tenantRepository
            .findById(tenantId)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "TENANT_NOT_FOUND"));
    SifenCscSecretStore.StoredCscRef ref = secretStore.store(tenantId, value);
    Instant now = Instant.now();

    Optional<SifenCsc> existing = cscRepository.findByTenant_IdAndIdCsc(tenantId, idCsc);
    SifenCsc row;
    if (existing.isPresent()) {
      row = existing.get();
    } else {
      row = new SifenCsc();
      row.setTenant(tenant);
      row.setIdCsc(idCsc);
      row.setCreatedAt(now);
      row.setActive(cscRepository.findByTenant_IdOrderByIdCscAsc(tenantId).isEmpty());
    }
    row.setSecretName(ref.secretName());
    row.setSecretVersion(ref.secretVersion());
    row.setUpdatedAt(now);
    row.setUpdatedByUserId(userId);
    cscRepository.save(row);

    log.info(
        "SIFEN CSC saved tenantId={} idCsc={} replaced={} active={}",
        tenantId,
        idCsc,
        existing.isPresent(),
        row.isActive());
    return toResponse(row);
  }

  /** Makes {@code idCsc} the one used to sign QRs; every other CSC of the tenant is deactivated. */
  @Transactional
  public SifenCscResponse activate(long tenantId, long userId, int idCsc) {
    List<SifenCsc> all = cscRepository.findByTenant_IdOrderByIdCscAsc(tenantId);
    SifenCsc target =
        all.stream()
            .filter(c -> c.getIdCsc() == idCsc)
            .findFirst()
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "CSC_NOT_FOUND"));
    Instant now = Instant.now();
    for (SifenCsc c : all) {
      boolean shouldBeActive = c == target;
      if (c.isActive() != shouldBeActive) {
        c.setActive(shouldBeActive);
        c.setUpdatedAt(now);
        c.setUpdatedByUserId(userId);
      }
    }
    // Flush the deactivation before the activation so the "one active per tenant" unique index
    // never sees two active rows at once.
    cscRepository.saveAllAndFlush(all.stream().filter(c -> !c.isActive()).toList());
    cscRepository.saveAndFlush(target);
    log.info("SIFEN CSC activated tenantId={} idCsc={}", tenantId, idCsc);
    return toResponse(target);
  }

  /** The CSC to hash the tenant's QRs with — see the class doc for the fallback rules. */
  @Transactional(readOnly = true)
  public SifenActiveCsc resolveActive(long tenantId) {
    Optional<SifenCsc> active = cscRepository.findByTenant_IdAndActiveTrue(tenantId);
    if (active.isPresent()) {
      SifenCsc row = active.get();
      String value =
          secretStore.load(
              tenantId,
              new SifenCscSecretStore.StoredCscRef(row.getSecretName(), row.getSecretVersion()));
      return new SifenActiveCsc(row.getIdCsc(), value);
    }
    boolean production =
        connectionProperties.activeEnvironment()
            == SifenConnectionProperties.Environment.PRODUCTION;
    if (production) {
      log.error("SIFEN CSC missing in PRODUCTION tenantId={}", tenantId);
      throw new ResponseStatusException(HttpStatus.PRECONDITION_FAILED, "SIFEN_CSC_NOT_CONFIGURED");
    }
    return new SifenActiveCsc(qrProperties.getActiveCscId(), qrProperties.activeCscSecret());
  }

  static int validateIdCsc(Integer idCsc) {
    if (idCsc == null || idCsc < MIN_ID_CSC || idCsc > MAX_ID_CSC) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_CSC_ID");
    }
    return idCsc;
  }

  static String validateCsc(String csc) {
    String trimmed = csc == null ? "" : csc.trim();
    if (!CSC_FORMAT.matcher(trimmed).matches()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_CSC_FORMAT");
    }
    return trimmed;
  }

  private static SifenCscResponse toResponse(SifenCsc c) {
    return new SifenCscResponse(c.getIdCsc(), c.isActive(), c.getCreatedAt(), c.getUpdatedAt());
  }
}
