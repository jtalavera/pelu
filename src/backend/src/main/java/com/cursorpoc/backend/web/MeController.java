package com.cursorpoc.backend.web;

import com.cursorpoc.backend.config.FemmeSystemAdminProperties;
import com.cursorpoc.backend.domain.AppUser;
import com.cursorpoc.backend.domain.Professional;
import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.repository.AppUserRepository;
import com.cursorpoc.backend.repository.ProfessionalRepository;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.service.AuthService;
import com.cursorpoc.backend.web.dto.ChangePasswordRequest;
import com.cursorpoc.backend.web.dto.MeProfileResponse;
import com.cursorpoc.backend.web.dto.MeProfileUpdateRequest;
import com.cursorpoc.backend.web.dto.MeResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api")
public class MeController {

  private static final Logger log = LoggerFactory.getLogger(MeController.class);

  private final FemmeSystemAdminProperties systemAdminProperties;
  private final ProfessionalRepository professionalRepository;
  private final AppUserRepository appUserRepository;
  private final PasswordEncoder passwordEncoder;

  public MeController(
      FemmeSystemAdminProperties systemAdminProperties,
      ProfessionalRepository professionalRepository,
      AppUserRepository appUserRepository,
      PasswordEncoder passwordEncoder) {
    this.systemAdminProperties = systemAdminProperties;
    this.professionalRepository = professionalRepository;
    this.appUserRepository = appUserRepository;
    this.passwordEncoder = passwordEncoder;
  }

  @GetMapping("/me")
  public MeResponse me(@AuthenticationPrincipal FemmeUserPrincipal principal) {
    log.info("GET /api/me tenantId={}", principal == null ? "null" : principal.getTenantId());
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    Long preview =
        principal.getRole() == UserRole.SYSTEM_ADMIN ? systemAdminProperties.getTenantId() : null;

    MeProfileResponse profile = null;
    if (principal.getProfessionalId() != null) {
      profile =
          professionalRepository
              .findByIdAndTenant_Id(principal.getProfessionalId(), principal.getTenantId())
              .map(
                  p ->
                      new MeProfileResponse(
                          p.getFullName(),
                          p.getPhone(),
                          p.getEmail(),
                          p.getAddress(),
                          p.getPhotoDataUrl()))
              .orElse(null);
    }

    MeResponse resp =
        new MeResponse(
            principal.getUserId(),
            principal.getTenantId(),
            principal.getUsername(),
            principal.getRole().name(),
            principal.getProfessionalId(),
            preview,
            profile);
    log.info("GET /api/me tenantId={} status=200", principal.getTenantId());
    return resp;
  }

  @PutMapping("/me/profile")
  public ResponseEntity<MeProfileResponse> updateProfile(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @RequestBody MeProfileUpdateRequest request) {
    log.info(
        "PUT /api/me/profile tenantId={}", principal == null ? "null" : principal.getTenantId());
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }

    if (principal.getProfessionalId() == null) {
      // Admin without linked Professional: only allow email update on AppUser
      log.error(
          "PUT /api/me/profile tenantId={} status=403 - admin has no linked professional",
          principal.getTenantId());
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "PROFILE_NOT_EDITABLE_FOR_ADMIN");
    }

    Professional professional =
        professionalRepository
            .findByIdAndTenant_Id(principal.getProfessionalId(), principal.getTenantId())
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "PROFESSIONAL_NOT_FOUND"));

    if (request.fullName() != null && !request.fullName().isBlank()) {
      professional.setFullName(request.fullName().trim());
    }
    if (request.phone() != null) {
      professional.setPhone(request.phone().trim().isEmpty() ? null : request.phone().trim());
    }
    if (request.email() != null) {
      professional.setEmail(request.email().trim().isEmpty() ? null : request.email().trim());
    }
    if (request.address() != null) {
      professional.setAddress(request.address().trim().isEmpty() ? null : request.address().trim());
    }
    if (request.photoDataUrl() != null) {
      professional.setPhotoDataUrl(
          request.photoDataUrl().isEmpty() ? null : request.photoDataUrl());
    }
    professionalRepository.save(professional);

    MeProfileResponse resp =
        new MeProfileResponse(
            professional.getFullName(),
            professional.getPhone(),
            professional.getEmail(),
            professional.getAddress(),
            professional.getPhotoDataUrl());
    log.info("PUT /api/me/profile tenantId={} status=200", principal.getTenantId());
    return ResponseEntity.ok(resp);
  }

  @PostMapping("/me/change-password")
  public ResponseEntity<Void> changePassword(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @RequestBody ChangePasswordRequest request) {
    log.info(
        "POST /api/me/change-password tenantId={}",
        principal == null ? "null" : principal.getTenantId());
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }

    String newPassword = request.newPassword();
    AuthService.validatePasswordStrength(newPassword);

    AppUser user =
        appUserRepository
            .findById(principal.getUserId())
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "USER_NOT_FOUND"));

    user.setPasswordHash(passwordEncoder.encode(newPassword));
    appUserRepository.save(user);

    log.info("POST /api/me/change-password tenantId={} status=200", principal.getTenantId());
    return ResponseEntity.noContent().build();
  }
}
