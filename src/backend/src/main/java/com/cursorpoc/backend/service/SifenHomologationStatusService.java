package com.cursorpoc.backend.service;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.TenantSifenHomologationStatus;
import com.cursorpoc.backend.domain.enums.SifenHomologationStatus;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.repository.TenantSifenHomologationStatusRepository;
import com.cursorpoc.backend.web.dto.TenantSifenHomologationResponse;
import java.time.LocalDateTime;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * RT-19 (Hardening_SIFEN.md): tracks whether a tenant has completed SIFEN homologación, so a
 * Platform Admin turning on {@code SIFEN_ELECTRONIC_INVOICING} in production sees whether that
 * tenant was ever cleared — informative, not a hard gate (see {@link SifenHomologationStatus}
 * javadoc).
 */
@Service
public class SifenHomologationStatusService {

  private final TenantSifenHomologationStatusRepository repository;
  private final TenantRepository tenantRepository;
  private final FemmeTimeProperties timeProperties;

  public SifenHomologationStatusService(
      TenantSifenHomologationStatusRepository repository,
      TenantRepository tenantRepository,
      FemmeTimeProperties timeProperties) {
    this.repository = repository;
    this.tenantRepository = tenantRepository;
    this.timeProperties = timeProperties;
  }

  @Transactional(readOnly = true)
  public TenantSifenHomologationResponse getStatus(long tenantId) {
    requireTenant(tenantId);
    return repository
        .findByTenantId(tenantId)
        .map(this::toResponse)
        .orElse(new TenantSifenHomologationResponse(SifenHomologationStatus.PENDING, null, null));
  }

  @Transactional
  public TenantSifenHomologationResponse setStatus(
      long tenantId, SifenHomologationStatus status, long markedByUserId, String markedByEmail) {
    requireTenant(tenantId);
    TenantSifenHomologationStatus row =
        repository
            .findByTenantId(tenantId)
            .orElseGet(
                () -> {
                  TenantSifenHomologationStatus s = new TenantSifenHomologationStatus();
                  s.setTenantId(tenantId);
                  return s;
                });
    row.setStatus(status);
    row.setMarkedByUserId(markedByUserId);
    row.setMarkedByEmail(markedByEmail);
    row.setMarkedAt(LocalDateTime.now(timeProperties.zoneId()));
    return toResponse(repository.save(row));
  }

  private TenantSifenHomologationResponse toResponse(TenantSifenHomologationStatus row) {
    return new TenantSifenHomologationResponse(
        row.getStatus(),
        row.getMarkedByEmail(),
        row.getMarkedAt().atZone(timeProperties.zoneId()).toInstant());
  }

  private void requireTenant(long tenantId) {
    if (!tenantRepository.existsById(tenantId)) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "TENANT_NOT_FOUND");
    }
  }
}
