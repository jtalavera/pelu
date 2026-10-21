package com.cursorpoc.backend.web;

import com.cursorpoc.backend.domain.ServiceRecord;
import com.cursorpoc.backend.repository.ServiceRecordRepository;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Test-only support endpoint, gated behind {@code femme.data-init.enabled} like {@link
 * AppointmentTestSupportController} (true only for the {@code e2e} Spring profile). Never reachable
 * in production.
 *
 * <p>HU-67: a service record is closed by issuing its invoice, which stamps {@code closedAt} with
 * the real clock, so Playwright cannot seed a service done 13 months ago (outside the usual
 * professional window) through the real API alone. This shifts an existing record's {@code
 * createdAt}/{@code closedAt} into the past. The lookup is tenant-scoped via the principal.
 */
@RestController
@RequestMapping("/api/admin/service-record-test-support")
@ConditionalOnProperty(name = "femme.data-init.enabled", havingValue = "true")
public class ServiceRecordTestSupportController {

  private static final Logger log =
      LoggerFactory.getLogger(ServiceRecordTestSupportController.class);

  private final ServiceRecordRepository serviceRecordRepository;

  public ServiceRecordTestSupportController(ServiceRecordRepository serviceRecordRepository) {
    this.serviceRecordRepository = serviceRecordRepository;
  }

  @PostMapping("/{id}/backdate/{daysAgo}")
  @Transactional
  public void backdate(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @PathVariable long id,
      @PathVariable long daysAgo) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    long tenantId = principal.getTenantId();
    log.info(
        "POST /api/admin/service-record-test-support/{}/backdate/{} tenantId={}",
        id,
        daysAgo,
        tenantId);
    ServiceRecord record =
        serviceRecordRepository
            .findByIdAndTenant_Id(id, tenantId)
            .orElseThrow(
                () ->
                    new ResponseStatusException(HttpStatus.NOT_FOUND, "SERVICE_RECORD_NOT_FOUND"));
    Instant when = Instant.now().minus(daysAgo, ChronoUnit.DAYS);
    record.setCreatedAt(when);
    if (record.getClosedAt() != null) {
      record.setClosedAt(when);
    }
    serviceRecordRepository.save(record);
    log.info(
        "POST /api/admin/service-record-test-support/{}/backdate/{} tenantId={} status=200",
        id,
        daysAgo,
        tenantId);
  }
}
