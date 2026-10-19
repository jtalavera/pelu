package com.cursorpoc.backend.web;

import com.cursorpoc.backend.commission.CommissionAccess;
import com.cursorpoc.backend.commission.CommissionConfigService;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * e2e only (same guard as {@link AppointmentTestSupportController}): makes the tenant's scheduled
 * commission changes take effect now, standing in for "the effective date arrived" (HU-COM-09).
 */
@RestController
@RequestMapping("/api/admin/commission-test-support")
@ConditionalOnProperty(name = "femme.data-init.enabled", havingValue = "true")
public class CommissionTestSupportController {

  private static final Logger log = LoggerFactory.getLogger(CommissionTestSupportController.class);

  private final CommissionAccess access;
  private final CommissionConfigService configService;

  public CommissionTestSupportController(
      CommissionAccess access, CommissionConfigService configService) {
    this.access = access;
    this.configService = configService;
  }

  @PostMapping("/make-scheduled-effective")
  public Map<String, Integer> makeScheduledEffective(
      @AuthenticationPrincipal FemmeUserPrincipal p) {
    access.requireAdmin(p);
    log.info(
        "POST /api/admin/commission-test-support/make-scheduled-effective tenantId={}",
        p.getTenantId());
    int count = configService.makeScheduledEffectiveNow(p.getTenantId());
    log.info(
        "POST /api/admin/commission-test-support/make-scheduled-effective tenantId={} status=200 count={}",
        p.getTenantId(),
        count);
    return Map.of("count", count);
  }
}
