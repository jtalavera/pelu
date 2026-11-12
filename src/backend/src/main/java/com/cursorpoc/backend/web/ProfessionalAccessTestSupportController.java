package com.cursorpoc.backend.web;

import com.cursorpoc.backend.domain.ProfessionalActivationToken;
import com.cursorpoc.backend.repository.ProfessionalActivationTokenRepository;
import com.cursorpoc.backend.repository.ProfessionalRepository;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import java.time.Duration;
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
 * AppointmentTestSupportController} (true only for the {@code e2e} profile). Never reachable in
 * production.
 *
 * <p>Issue #38 (5): the "Reenviar invitación" button is only usable 2 minutes after the last send,
 * and an invitation expires after 48 h. This shifts the latest invitation of a professional back in
 * time so Playwright can cover both rules without waiting on a real clock. Tenant-scoped through
 * the authenticated principal, same as every production lookup.
 */
@RestController
@RequestMapping("/api/admin/professional-access-test-support")
@ConditionalOnProperty(name = "femme.data-init.enabled", havingValue = "true")
public class ProfessionalAccessTestSupportController {

  private static final Logger log =
      LoggerFactory.getLogger(ProfessionalAccessTestSupportController.class);

  private final ProfessionalRepository professionalRepository;
  private final ProfessionalActivationTokenRepository activationTokenRepository;

  public ProfessionalAccessTestSupportController(
      ProfessionalRepository professionalRepository,
      ProfessionalActivationTokenRepository activationTokenRepository) {
    this.professionalRepository = professionalRepository;
    this.activationTokenRepository = activationTokenRepository;
  }

  @PostMapping("/{id}/backdate-invitation/{seconds}")
  @Transactional
  public void backdateInvitation(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @PathVariable long id,
      @PathVariable long seconds) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    log.info(
        "POST /api/admin/professional-access-test-support/{}/backdate-invitation/{} tenantId={}",
        id,
        seconds,
        principal.getTenantId());
    professionalRepository
        .findByIdAndTenant_Id(id, principal.getTenantId())
        .orElseThrow(
            () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "PROFESSIONAL_NOT_FOUND"));
    ProfessionalActivationToken token =
        activationTokenRepository
            .findFirstByProfessional_IdOrderByIdDesc(id)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "INVITATION_NOT_FOUND"));
    Duration shift = Duration.ofSeconds(seconds);
    token.setCreatedAt(token.getCreatedAt().minus(shift));
    token.setExpiresAt(token.getExpiresAt().minus(shift));
    activationTokenRepository.save(token);
    log.info(
        "POST /api/admin/professional-access-test-support/{}/backdate-invitation/{} tenantId={}"
            + " status=200",
        id,
        seconds,
        principal.getTenantId());
  }
}
