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
import java.util.Objects;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class ProfessionalDirectoryService {

  private static final int MAX_PHOTO_DATA_URL_CHARS = 2_500_000;

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
    applyUpsert(p, request);
    p.setActive(true);
    professionalRepository.save(p);
    replaceSchedules(p.getId(), request.schedules());
    return toResponse(p, schedulesFor(p.getId()));
  }

  @Transactional
  public ProfessionalResponse update(
      long tenantId, long professionalId, ProfessionalUpsertRequest request) {
    Professional p = loadProfessionalOrThrow(tenantId, professionalId);
    applyUpsert(p, request);
    professionalRepository.save(p);
    replaceSchedules(p.getId(), request.schedules());
    return toResponse(p, schedulesFor(p.getId()));
  }

  @Transactional
  public ProfessionalResponse deactivate(long tenantId, long professionalId) {
    Professional p = loadProfessionalOrThrow(tenantId, professionalId);
    p.setActive(false);
    professionalRepository.save(p);
    return toResponse(p, schedulesFor(p.getId()));
  }

  private void applyUpsert(Professional p, ProfessionalUpsertRequest request) {
    String name = request.fullName() == null ? "" : request.fullName().trim();
    if (name.isEmpty()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "PROFESSIONAL_NAME_REQUIRED");
    }
    p.setFullName(name);
    p.setPhone(blankToNull(request.phone()));
    p.setEmail(blankToNull(request.email()));
    if (request.photoDataUrl() != null) {
      if (request.photoDataUrl().isBlank()) {
        p.setPhotoDataUrl(null);
      } else {
        validatePhotoDataUrl(request.photoDataUrl());
        p.setPhotoDataUrl(request.photoDataUrl());
      }
    }
    validateSchedules(request.schedules());
  }

  private void validateSchedules(List<ProfessionalScheduleRequest> schedules) {
    if (schedules == null) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "PROFESSIONAL_SCHEDULES_REQUIRED");
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
    // Disallow overlaps within same day (simple O(n^2) per day; small weekly templates).
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

  private static ProfessionalResponse toResponse(
      Professional p, List<ProfessionalSchedule> schedules) {
    return new ProfessionalResponse(
        p.getId(),
        p.getFullName(),
        p.getPhone(),
        p.getEmail(),
        p.getPhotoDataUrl(),
        p.isActive(),
        schedules.stream()
            .map(
                s ->
                    new ProfessionalResponse.Schedule(
                        s.getDayOfWeek(), s.getStartTime(), s.getEndTime()))
            .toList());
  }

  private static void validatePhotoDataUrl(String dataUrl) {
    if (dataUrl.length() > MAX_PHOTO_DATA_URL_CHARS) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "PHOTO_TOO_LARGE");
    }
    if (!dataUrl.startsWith("data:image/")) {
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
