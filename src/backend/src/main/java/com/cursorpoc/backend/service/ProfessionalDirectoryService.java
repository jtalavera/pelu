package com.cursorpoc.backend.service;

import com.cursorpoc.backend.domain.Professional;
import com.cursorpoc.backend.domain.ProfessionalSchedule;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.repository.ProfessionalRepository;
import com.cursorpoc.backend.repository.ProfessionalScheduleRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.web.dto.ProfessionalResponse;
import com.cursorpoc.backend.web.dto.ProfessionalScheduleRequest;
import com.cursorpoc.backend.web.dto.ProfessionalUpsertRequest;
import java.time.LocalTime;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class ProfessionalDirectoryService {

  private static final int MAX_PHOTO_DATA_URL_CHARS = 7_200_000;

  private final TenantRepository tenantRepository;
  private final ProfessionalRepository professionalRepository;
  private final ProfessionalScheduleRepository professionalScheduleRepository;

  public ProfessionalDirectoryService(
      TenantRepository tenantRepository,
      ProfessionalRepository professionalRepository,
      ProfessionalScheduleRepository professionalScheduleRepository) {
    this.tenantRepository = tenantRepository;
    this.professionalRepository = professionalRepository;
    this.professionalScheduleRepository = professionalScheduleRepository;
  }

  @Transactional(readOnly = true)
  public List<ProfessionalResponse> list(long tenantId) {
    return professionalRepository.findByTenant_IdOrderByFullNameAsc(tenantId).stream()
        .map(p -> toResponse(p, schedulesFor(p.getId())))
        .toList();
  }

  @Transactional
  public ProfessionalResponse create(long tenantId, ProfessionalUpsertRequest request) {
    Tenant tenant = loadTenantOrThrow(tenantId);
    Professional p = new Professional();
    p.setTenant(tenant);
    applyUpsert(p, request, tenantId);
    p.setActive(true);
    professionalRepository.save(p);
    return toResponse(p, schedulesFor(p.getId()));
  }

  @Transactional
  public ProfessionalResponse update(
      long tenantId, long professionalId, ProfessionalUpsertRequest request) {
    Professional p = loadProfessionalOrThrow(tenantId, professionalId);
    applyUpsert(p, request, tenantId);
    professionalRepository.save(p);
    return toResponse(p, schedulesFor(p.getId()));
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
    String name = request.fullName() == null ? "" : request.fullName().trim();
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
              : professionalRepository.existsByTenant_IdAndEmailIgnoreCaseAndIdNot(tenantId, email, p.getId());
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
      p.setPinFingerprint(null);
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
      duplicate = professionalRepository.existsByTenant_IdAndPinFingerprintAndIdNot(tenantId, fingerprint, excludeId);
    }
    if (duplicate) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "PIN_ALREADY_IN_USE");
    }
    p.setPinFingerprint(fingerprint);
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

  static ProfessionalResponse toResponse(Professional p, List<ProfessionalSchedule> schedules) {
    return new ProfessionalResponse(
        p.getId(),
        p.getFullName(),
        p.getPhone(),
        p.getEmail(),
        p.getPhotoDataUrl(),
        p.isActive(),
        schedules.stream()
            .map(s -> new ProfessionalResponse.Schedule(s.getDayOfWeek(), s.getStartTime(), s.getEndTime()))
            .toList(),
        p.getPinFingerprint() != null,
        p.isSystemAccessAllowed(),
        p.getUser() != null);
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
