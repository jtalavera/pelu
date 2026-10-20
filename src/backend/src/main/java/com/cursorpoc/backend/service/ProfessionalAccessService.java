package com.cursorpoc.backend.service;

import com.cursorpoc.backend.domain.AppUser;
import com.cursorpoc.backend.domain.Professional;
import com.cursorpoc.backend.domain.ProfessionalActivationToken;
import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.repository.AppUserRepository;
import com.cursorpoc.backend.repository.ProfessionalActivationTokenRepository;
import com.cursorpoc.backend.repository.ProfessionalRepository;
import com.cursorpoc.backend.util.EmailFormatValidator;
import com.cursorpoc.backend.web.dto.GrantAccessResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * HU-23 + issue #38: everything about a professional's "Acceso al sistema" — invitations, revoking,
 * resending (with a cooldown), the email-change rules and the status shown in the form.
 *
 * <ul>
 *   <li>(1) Access always needs a valid email — checked on every path that enables it.
 *   <li>(2) Changing the email detaches the user tied to the old one (disabled, so it can't log in
 *       any more); with access still on, a new invitation goes to the new email.
 *   <li>(3) An email belongs to one user of the tenant, and a user to one professional at a time.
 *   <li>(4) {@link AccessStatus} drives the status line.
 *   <li>(5) Resending is only possible while an invitation is pending, once per cooldown.
 * </ul>
 */
@Service
public class ProfessionalAccessService {

  private static final Logger log = LoggerFactory.getLogger(ProfessionalAccessService.class);

  public static final Duration INVITATION_TTL = Duration.ofHours(48);

  /** Issue #38 (4): the "Estatus del acceso al sistema" values. */
  public enum AccessStatus {
    /** "Acceso al sistema" is off. */
    NO_ACCESS,
    /** Invitation sent, password not created yet, link still valid. */
    INVITATION_SENT,
    /** Invitation sent, password not created, link expired — needs a resend. */
    INVITATION_EXPIRED,
    /** Password created: the professional can log in with her email. */
    ACTIVE
  }

  /** What the form needs to render the access section. */
  public record AccessInfo(
      AccessStatus status,
      String loginEmail,
      Instant invitationSentAt,
      Instant invitationExpiresAt,
      Instant resendAvailableAt) {}

  private final ProfessionalRepository professionalRepository;
  private final ProfessionalActivationTokenRepository activationTokenRepository;
  private final AppUserRepository appUserRepository;
  private final EmailService emailService;
  private final String frontendUrl;
  private final Duration resendCooldown;

  public ProfessionalAccessService(
      ProfessionalRepository professionalRepository,
      ProfessionalActivationTokenRepository activationTokenRepository,
      AppUserRepository appUserRepository,
      EmailService emailService,
      @Value("${app.frontend.url}") String frontendUrl,
      @Value("${app.femme.professional-access.resend-cooldown-seconds:120}")
          long resendCooldownSeconds) {
    this.professionalRepository = professionalRepository;
    this.activationTokenRepository = activationTokenRepository;
    this.appUserRepository = appUserRepository;
    this.emailService = emailService;
    this.frontendUrl = frontendUrl;
    this.resendCooldown = Duration.ofSeconds(resendCooldownSeconds);
  }

  /**
   * (1)+(3): throws unless {@code professional} may hold system access with her current email.
   * Called before anything is saved, so a rejected request changes nothing.
   */
  public void requireEligibleForAccess(Professional professional) {
    String email = normalize(professional.getEmail());
    if (email == null) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "PROFESSIONAL_EMAIL_REQUIRED_FOR_ACCESS");
    }
    if (!EmailFormatValidator.isValid(email)) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "PROFESSIONAL_EMAIL_INVALID_FOR_ACCESS");
    }
    Optional<AppUser> owner =
        appUserRepository.findByEmailAndTenant_Id(email, professional.getTenant().getId());
    if (owner.isPresent() && !isReusableBy(owner.get(), professional)) {
      throw new ResponseStatusException(
          HttpStatus.CONFLICT, "PROFESSIONAL_EMAIL_USED_BY_ANOTHER_USER");
    }
  }

  /**
   * (3): an existing user with the professional's email can back her account only when it is a
   * PROFESSIONAL user that is hers already or nobody's — never an admin, never another
   * professional's.
   */
  public boolean isReusableBy(AppUser user, Professional professional) {
    if (user.getRole() != UserRole.PROFESSIONAL) {
      return false;
    }
    return professionalRepository
        .findByUser_Id(user.getId())
        .map(linked -> linked.getId().equals(professional.getId()))
        .orElse(true);
  }

  /**
   * HU-23 AC-4/5/13: issues a fresh 48 h invitation (invalidating any previous link), turns access
   * on and emails the link. Validates eligibility first.
   */
  @Transactional
  public GrantAccessResponse invite(Professional professional, Locale locale) {
    requireEligibleForAccess(professional);
    String email = normalize(professional.getEmail());

    activationTokenRepository.invalidateAllForProfessional(professional.getId());
    String raw = UUID.randomUUID().toString();
    Instant now = Instant.now();
    ProfessionalActivationToken token = new ProfessionalActivationToken();
    token.setProfessional(professional);
    token.setTokenHash(AuthService.sha256Hex(raw));
    token.setCreatedAt(now);
    token.setExpiresAt(now.plus(INVITATION_TTL));
    token.setUsed(false);
    activationTokenRepository.save(token);

    professional.setSystemAccessAllowed(true);
    professionalRepository.save(professional);

    String activationUrl = frontendUrl + "/activate?token=" + raw;
    emailService.sendActivationLink(
        email, activationUrl, professional.getTenant().getName(), locale);
    log.info(
        "professional access invitation sent tenantId={} professionalId={}",
        professional.getTenant().getId(),
        professional.getId());
    return new GrantAccessResponse(true, raw);
  }

  /**
   * (5): resends the invitation — only while one is pending (sent, no password yet) and once the
   * cooldown since the last send has elapsed.
   */
  @Transactional
  public GrantAccessResponse resend(Professional professional, Locale locale) {
    AccessInfo info = info(professional);
    if (info.status() == AccessStatus.NO_ACCESS) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "PROFESSIONAL_ACCESS_NOT_ENABLED");
    }
    if (info.status() == AccessStatus.ACTIVE) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "PROFESSIONAL_ACCESS_ALREADY_ACTIVE");
    }
    if (info.resendAvailableAt() != null && Instant.now().isBefore(info.resendAvailableAt())) {
      throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "ACTIVATION_RESEND_TOO_SOON");
    }
    return invite(professional, locale);
  }

  /**
   * HU-23 AC-14: access off. The professional's user is disabled (open sessions die on their next
   * request) and pending links stop working. A non-PROFESSIONAL user linked to her (legacy data: an
   * admin who is also on the professionals list) is never disabled here.
   */
  @Transactional
  public void revoke(Professional professional) {
    professional.setSystemAccessAllowed(false);
    AppUser user = professional.getUser();
    if (user != null && user.getRole() == UserRole.PROFESSIONAL) {
      user.setEnabled(false);
      appUserRepository.save(user);
    }
    activationTokenRepository.invalidateAllForProfessional(professional.getId());
    professionalRepository.save(professional);
  }

  /**
   * (2): the email changed — the user (and any pending link) tied to the old email no longer
   * belongs to this professional. The old user is disabled and unlinked; the caller sends a new
   * invitation when access stays on.
   */
  @Transactional
  public void detachForEmailChange(Professional professional) {
    AppUser user = professional.getUser();
    if (user != null) {
      if (user.getRole() == UserRole.PROFESSIONAL) {
        user.setEnabled(false);
        appUserRepository.save(user);
      }
      professional.setUser(null);
    }
    activationTokenRepository.invalidateAllForProfessional(professional.getId());
    professionalRepository.save(professional);
    log.info(
        "professional access detached after email change tenantId={} professionalId={}",
        professional.getTenant().getId(),
        professional.getId());
  }

  /** (4)+(5): status line + resend availability. */
  @Transactional(readOnly = true)
  public AccessInfo info(Professional professional) {
    if (!professional.isSystemAccessAllowed()) {
      return new AccessInfo(AccessStatus.NO_ACCESS, null, null, null, null);
    }
    AppUser user = professional.getUser();
    if (user != null && user.isEnabled()) {
      return new AccessInfo(AccessStatus.ACTIVE, user.getEmail(), null, null, null);
    }
    Optional<ProfessionalActivationToken> latest =
        professional.getId() == null
            ? Optional.empty()
            : activationTokenRepository.findFirstByProfessional_IdOrderByIdDesc(
                professional.getId());
    Instant sentAt = latest.map(ProfessionalActivationToken::getCreatedAt).orElse(null);
    Instant expiresAt =
        latest.filter(t -> !t.isUsed()).map(ProfessionalActivationToken::getExpiresAt).orElse(null);
    boolean pending = expiresAt != null && Instant.now().isBefore(expiresAt);
    Instant resendAt = sentAt == null ? null : sentAt.plus(resendCooldown);
    return new AccessInfo(
        pending ? AccessStatus.INVITATION_SENT : AccessStatus.INVITATION_EXPIRED,
        normalize(professional.getEmail()),
        sentAt,
        expiresAt,
        resendAt);
  }

  static String normalize(String email) {
    if (email == null) {
      return null;
    }
    String t = email.trim().toLowerCase(Locale.ROOT);
    return t.isEmpty() ? null : t;
  }
}
