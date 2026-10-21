package com.cursorpoc.backend.service;

import com.cursorpoc.backend.domain.Professional;
import com.cursorpoc.backend.domain.ProfessionalSchedule;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.repository.ProfessionalRepository;
import com.cursorpoc.backend.repository.ProfessionalScheduleRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.web.dto.GrantAccessResponse;
import com.cursorpoc.backend.web.dto.PageResponse;
import com.cursorpoc.backend.web.dto.ProfessionalResponse;
import com.cursorpoc.backend.web.dto.ProfessionalScheduleRequest;
import com.cursorpoc.backend.web.dto.ProfessionalUpsertRequest;
import java.time.LocalTime;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.stream.Collectors;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class ProfessionalDirectoryService {

  private static final int MAX_PHOTO_DATA_URL_CHARS = 7_200_000;

  private final TenantRepository tenantRepository;
  private final ProfessionalRepository professionalRepository;
  private final ProfessionalScheduleRepository professionalScheduleRepository;
  private final ProfessionalAccessService professionalAccessService;
  private final SharedDeviceService sharedDeviceService;
  private final PasswordEncoder passwordEncoder;

  public ProfessionalDirectoryService(
      TenantRepository tenantRepository,
      ProfessionalRepository professionalRepository,
      ProfessionalScheduleRepository professionalScheduleRepository,
      ProfessionalAccessService professionalAccessService,
      SharedDeviceService sharedDeviceService,
      PasswordEncoder passwordEncoder) {
    this.tenantRepository = tenantRepository;
    this.professionalRepository = professionalRepository;
    this.professionalScheduleRepository = professionalScheduleRepository;
    this.professionalAccessService = professionalAccessService;
    this.sharedDeviceService = sharedDeviceService;
    this.passwordEncoder = passwordEncoder;
  }

  @Transactional(readOnly = true)
  public List<ProfessionalResponse> list(long tenantId) {
    return professionalRepository.findByTenant_IdOrderByFullNameAsc(tenantId).stream()
        .map(p -> toResponse(p, schedulesFor(p.getId())))
        .toList();
  }

  /**
   * Issue #38 follow-up: the professional filter / appointment form a logged-in professional sees —
   * names, photo and schedules only; contact data and access/PIN details stay admin-only.
   */
  @Transactional(readOnly = true)
  public List<ProfessionalResponse> listDirectory(long tenantId) {
    return professionalRepository.findByTenant_IdOrderByFullNameAsc(tenantId).stream()
        .map(p -> toDirectoryResponse(p, schedulesFor(p.getId())))
        .toList();
  }

  @Transactional(readOnly = true)
  public PageResponse<ProfessionalResponse> listPaged(long tenantId, String q, int page, int size) {
    String qTrimmed = (q != null && !q.isBlank()) ? q.trim() : null;
    PageRequest pageable = PageRequest.of(page, Math.max(1, Math.min(size, 200)));
    Page<Professional> result =
        professionalRepository.findByTenantFilteredPaged(tenantId, qTrimmed, pageable);
    List<ProfessionalResponse> content =
        result.getContent().stream()
            .map(p -> toResponse(p, schedulesFor(p.getId())))
            .collect(Collectors.toList());
    return new PageResponse<>(
        content,
        result.getNumber(),
        result.getSize(),
        result.getTotalElements(),
        result.getTotalPages());
  }

  @Transactional
  public ProfessionalResponse create(
      long tenantId, ProfessionalUpsertRequest request, Locale locale) {
    Tenant tenant = loadTenantOrThrow(tenantId);
    Professional p = new Professional();
    p.setTenant(tenant);
    applyUpsert(p, request, tenantId);
    p.setActive(true);
    boolean wantsAccess = Boolean.TRUE.equals(request.systemAccessAllowed());
    if (wantsAccess) {
      professionalAccessService.requireEligibleForAccess(p);
    }
    professionalRepository.save(p);
    if (wantsAccess) {
      professionalAccessService.invite(p, locale);
    }
    return toResponse(p, schedulesFor(p.getId()));
  }

  /**
   * Issue #38: details and "Acceso al sistema" are saved together, in one transaction — a request
   * that turns access on without a valid, free email is rejected before anything is stored (1)(3),
   * and an email change detaches the old-email user, re-inviting the new email when access stays on
   * (2). {@code systemAccessAllowed == null} keeps the current access setting.
   */
  @Transactional
  public ProfessionalResponse update(
      long tenantId, long professionalId, ProfessionalUpsertRequest request, Locale locale) {
    Professional p = loadProfessionalOrThrow(tenantId, professionalId);
    String previousEmail = ProfessionalAccessService.normalize(p.getEmail());
    boolean hadAccess = p.isSystemAccessAllowed();
    applyUpsert(p, request, tenantId);
    boolean wantsAccess =
        request.systemAccessAllowed() == null ? hadAccess : request.systemAccessAllowed();
    boolean emailChanged =
        !Objects.equals(previousEmail, ProfessionalAccessService.normalize(p.getEmail()));
    boolean issuesInvitation = wantsAccess && (!hadAccess || emailChanged);
    if (issuesInvitation) {
      professionalAccessService.requireEligibleForAccess(p);
    }
    professionalRepository.save(p);
    if (emailChanged) {
      professionalAccessService.detachForEmailChange(p);
    }
    if (issuesInvitation) {
      professionalAccessService.invite(p, locale);
    } else if (!wantsAccess && hadAccess) {
      professionalAccessService.revoke(p);
    }
    return toResponse(p, schedulesFor(p.getId()));
  }

  /** HU-23 AC-4/13: (re)issue the invitation, no cooldown — the explicit "grant" action. */
  @Transactional
  public GrantAccessResponse grantAccess(long tenantId, long professionalId, Locale locale) {
    return professionalAccessService.invite(
        loadProfessionalOrThrow(tenantId, professionalId), locale);
  }

  /** Issue #38 (5): the "Reenviar invitación" button — pending invitations only, with cooldown. */
  @Transactional
  public ProfessionalResponse resendAccess(long tenantId, long professionalId, Locale locale) {
    Professional p = loadProfessionalOrThrow(tenantId, professionalId);
    professionalAccessService.resend(p, locale);
    return toResponse(p, schedulesFor(p.getId()));
  }

  /** HU-66: lifts the professional's PIN lock on every shared device. */
  @Transactional
  public ProfessionalResponse unlockPin(long tenantId, long professionalId) {
    Professional p = loadProfessionalOrThrow(tenantId, professionalId);
    sharedDeviceService.unlockProfessional(tenantId, professionalId);
    return toResponse(p, schedulesFor(p.getId()));
  }

  /** HU-23 AC-14. */
  @Transactional
  public void revokeAccess(long tenantId, long professionalId) {
    professionalAccessService.revoke(loadProfessionalOrThrow(tenantId, professionalId));
  }

  @Transactional
  public ProfessionalResponse deactivate(long tenantId, long professionalId) {
    Professional p = loadProfessionalOrThrow(tenantId, professionalId);
    p.setActive(false);
    professionalRepository.save(p);
    return toResponse(p, schedulesFor(p.getId()));
  }

  @Transactional
  public ProfessionalResponse activate(long tenantId, long professionalId) {
    Professional p = loadProfessionalOrThrow(tenantId, professionalId);
    p.setActive(true);
    professionalRepository.save(p);
    return toResponse(p, schedulesFor(p.getId()));
  }

  @Transactional
  public ProfessionalResponse updateSchedules(
      long tenantId, long professionalId, List<ProfessionalScheduleRequest> schedules) {
    Professional p = loadProfessionalOrThrow(tenantId, professionalId);
    validateSchedules(schedules);
    replaceSchedules(p.getId(), schedules);
    return toResponse(p, schedulesFor(p.getId()));
  }

  private void applyUpsert(Professional p, ProfessionalUpsertRequest request, long tenantId) {
    String name =
        request.fullName() == null ? "" : request.fullName().trim().toUpperCase(Locale.ROOT);
    if (name.isEmpty()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "PROFESSIONAL_NAME_REQUIRED");
    }
    p.setFullName(name);
    p.setPhone(blankToNull(request.phone()));
    String email = blankToNull(request.email());
    if (email != null) {
      boolean duplicate =
          p.getId() == null
              ? professionalRepository.existsByTenant_IdAndEmailIgnoreCase(tenantId, email)
              : professionalRepository.existsByTenant_IdAndEmailIgnoreCaseAndIdNot(
                  tenantId, email, p.getId());
      if (duplicate) {
        throw new ResponseStatusException(HttpStatus.CONFLICT, "PROFESSIONAL_EMAIL_DUPLICATE");
      }
    }
    p.setEmail(email);
    if (request.photoDataUrl() != null) {
      if (request.photoDataUrl().isBlank()) {
        p.setPhotoDataUrl(null);
      } else {
        validatePhotoDataUrl(request.photoDataUrl());
        p.setPhotoDataUrl(request.photoDataUrl());
      }
    }
    applyPin(p, request.pin(), tenantId);
  }

  private void applyPin(Professional p, String rawPin, long tenantId) {
    if (rawPin == null) {
      return;
    }
    String trimmed = rawPin.trim();
    if (trimmed.isEmpty()) {
      if (p.hasPin()) {
        // HU-66: clearing the PIN ends any PIN session she has open.
        p.setPinVersion(p.getPinVersion() + 1);
      }
      p.setPinFingerprint(null);
      p.setPinHash(null);
      return;
    }
    if (!trimmed.matches("\\d{4,7}")) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_PIN_FORMAT");
    }
    String fingerprint = AuthService.sha256Hex(tenantId + ":" + trimmed);
    Long excludeId = p.getId() == null ? -1L : p.getId();
    boolean duplicate;
    if (p.getId() == null) {
      duplicate = professionalRepository.existsByTenant_IdAndPinFingerprint(tenantId, fingerprint);
    } else {
      duplicate =
          professionalRepository.existsByTenant_IdAndPinFingerprintAndIdNot(
              tenantId, fingerprint, excludeId);
    }
    if (duplicate) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "PIN_ALREADY_IN_USE");
    }
    if (!fingerprint.equals(p.getPinFingerprint())) {
      // HU-66: a new PIN ends any PIN session opened with the previous one.
      p.setPinVersion(p.getPinVersion() + 1);
    }
    p.setPinFingerprint(fingerprint);
    // HU-66: the PIN is a credential on shared devices — salted hash, like a password.
    p.setPinHash(passwordEncoder.encode(trimmed));
  }

  private void validateSchedules(List<ProfessionalScheduleRequest> schedules) {
    if (schedules == null || schedules.isEmpty()) {
      return;
    }
    for (ProfessionalScheduleRequest r : schedules) {
      if (r == null) {
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_PROFESSIONAL_SCHEDULE");
      }
      short dow = r.dayOfWeek();
      if (dow < 1 || dow > 7) {
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_DAY_OF_WEEK");
      }
      LocalTime start = r.startTime();
      LocalTime end = r.endTime();
      if (start == null || end == null) {
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_PROFESSIONAL_SCHEDULE");
      }
      if (!start.isBefore(end)) {
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_SCHEDULE_RANGE");
      }
    }
    schedules.stream()
        .filter(Objects::nonNull)
        .collect(java.util.stream.Collectors.groupingBy(ProfessionalScheduleRequest::dayOfWeek))
        .forEach(
            (dow, dayRanges) -> {
              List<ProfessionalScheduleRequest> sorted =
                  dayRanges.stream()
                      .sorted(Comparator.comparing(ProfessionalScheduleRequest::startTime))
                      .toList();
              for (int i = 1; i < sorted.size(); i++) {
                LocalTime prevEnd = sorted.get(i - 1).endTime();
                LocalTime nextStart = sorted.get(i).startTime();
                if (nextStart.isBefore(prevEnd)) {
                  throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "SCHEDULE_OVERLAP");
                }
              }
            });
  }

  private void replaceSchedules(Long professionalId, List<ProfessionalScheduleRequest> schedules) {
    professionalScheduleRepository.deleteByProfessionalId(professionalId);
    for (ProfessionalScheduleRequest r : schedules) {
      ProfessionalSchedule s = new ProfessionalSchedule();
      Professional pRef = new Professional();
      pRef.setId(professionalId);
      s.setProfessional(pRef);
      s.setDayOfWeek(r.dayOfWeek());
      s.setStartTime(r.startTime());
      s.setEndTime(r.endTime());
      professionalScheduleRepository.save(s);
    }
  }

  private List<ProfessionalSchedule> schedulesFor(Long professionalId) {
    return professionalScheduleRepository.findByProfessionalIdOrderByDayOfWeekAscIdAsc(
        professionalId);
  }

  private Tenant loadTenantOrThrow(long tenantId) {
    return tenantRepository
        .findById(tenantId)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "TENANT_NOT_FOUND"));
  }

  private Professional loadProfessionalOrThrow(long tenantId, long id) {
    return professionalRepository
        .findByIdAndTenant_Id(id, tenantId)
        .orElseThrow(
            () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "PROFESSIONAL_NOT_FOUND"));
  }

  private ProfessionalResponse toResponse(Professional p, List<ProfessionalSchedule> schedules) {
    ProfessionalAccessService.AccessInfo access = professionalAccessService.info(p);
    return new ProfessionalResponse(
        p.getId(),
        p.getFullName(),
        p.getPhone(),
        p.getEmail(),
        p.getPhotoDataUrl(),
        p.isActive(),
        toScheduleResponses(schedules),
        p.getPinFingerprint() != null,
        p.isSystemAccessAllowed(),
        p.getUser() != null,
        access.status().name(),
        access.loginEmail(),
        access.invitationSentAt(),
        access.invitationExpiresAt(),
        access.resendAvailableAt(),
        p.getId() == null ? List.of() : sharedDeviceService.activeLocks(p.getId()));
  }

  private static ProfessionalResponse toDirectoryResponse(
      Professional p, List<ProfessionalSchedule> schedules) {
    return new ProfessionalResponse(
        p.getId(),
        p.getFullName(),
        null,
        null,
        p.getPhotoDataUrl(),
        p.isActive(),
        toScheduleResponses(schedules),
        false,
        false,
        false,
        null,
        null,
        null,
        null,
        null,
        List.of());
  }

  private static List<ProfessionalResponse.Schedule> toScheduleResponses(
      List<ProfessionalSchedule> schedules) {
    return schedules.stream()
        .map(
            s ->
                new ProfessionalResponse.Schedule(
                    s.getDayOfWeek(), s.getStartTime(), s.getEndTime()))
        .toList();
  }

  private static void validatePhotoDataUrl(String dataUrl) {
    if (dataUrl.length() > MAX_PHOTO_DATA_URL_CHARS) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "PHOTO_TOO_LARGE");
    }
    String lower = dataUrl.toLowerCase(Locale.ROOT);
    boolean allowed =
        lower.startsWith("data:image/jpeg;base64,")
            || lower.startsWith("data:image/jpg;base64,")
            || lower.startsWith("data:image/png;base64,")
            || lower.startsWith("data:image/webp;base64,")
            || lower.startsWith("data:image/gif;base64,");
    if (!allowed) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "PHOTO_INVALID_FORMAT");
    }
  }

  private static String blankToNull(String s) {
    if (s == null) {
      return null;
    }
    String t = s.trim();
    return t.isEmpty() ? null : t;
  }
}
