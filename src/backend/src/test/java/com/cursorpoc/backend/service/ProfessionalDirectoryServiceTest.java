package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.lenient;

import com.cursorpoc.backend.domain.Professional;
import com.cursorpoc.backend.domain.ProfessionalSchedule;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.repository.ProfessionalRepository;
import com.cursorpoc.backend.repository.ProfessionalScheduleRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.web.dto.ProfessionalScheduleRequest;
import com.cursorpoc.backend.web.dto.ProfessionalUpsertRequest;
import java.time.LocalTime;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.web.server.ResponseStatusException;

@ExtendWith(MockitoExtension.class)
class ProfessionalDirectoryServiceTest {

  @Mock private TenantRepository tenantRepository;
  @Mock private ProfessionalRepository professionalRepository;
  @Mock private ProfessionalScheduleRepository professionalScheduleRepository;

  @InjectMocks private ProfessionalDirectoryService service;

  private Tenant tenant;
  private final AtomicLong ids = new AtomicLong(1);

  @BeforeEach
  void setUp() {
    tenant = new Tenant();
    tenant.setId(1L);
    tenant.setName("Demo");
    lenient().when(tenantRepository.findById(1L)).thenReturn(Optional.of(tenant));

    lenient()
        .when(professionalRepository.save(any(Professional.class)))
        .thenAnswer(
            inv -> {
              Professional p = inv.getArgument(0);
              if (p.getId() == null) {
                p.setId(ids.getAndIncrement());
              }
              return p;
            });
    lenient()
        .when(professionalScheduleRepository.save(any(ProfessionalSchedule.class)))
        .thenAnswer(
            inv -> {
              ProfessionalSchedule s = inv.getArgument(0);
              if (s.getId() == null) {
                s.setId(ids.getAndIncrement());
              }
              return s;
            });
  }

  @Test
  void create_trimsName_andSetsActive() {
    lenient()
        .when(professionalScheduleRepository.findByProfessionalIdOrderByDayOfWeekAscIdAsc(1L))
        .thenReturn(List.of());

    var req = new ProfessionalUpsertRequest("  Ana Gomez  ", "  555  ", "  ana@example.com ", null);

    var res = service.create(1L, req);
    assertThat(res.fullName()).isEqualTo("Ana Gomez");
    assertThat(res.active()).isTrue();
    assertThat(res.phone()).isEqualTo("555");
  }

  @Test
  void create_rejectsBlankName() {
    var req = new ProfessionalUpsertRequest("   ", null, null, null);
    assertThatThrownBy(() -> service.create(1L, req)).isInstanceOf(ResponseStatusException.class);
  }

  @Test
  void updateSchedules_rejectsOverlappingSchedules() {
    Professional p = new Professional();
    p.setId(10L);
    p.setTenant(tenant);
    p.setFullName("Ana");
    p.setActive(true);
    lenient().when(professionalRepository.findByIdAndTenant_Id(10L, 1L)).thenReturn(Optional.of(p));

    var schedules =
        List.of(
            new ProfessionalScheduleRequest((short) 1, LocalTime.of(9, 0), LocalTime.of(12, 0)),
            new ProfessionalScheduleRequest((short) 1, LocalTime.of(11, 0), LocalTime.of(13, 0)));

    assertThatThrownBy(() -> service.updateSchedules(1L, 10L, schedules))
        .isInstanceOf(ResponseStatusException.class);
  }

  @Test
  void updateSchedules_rejectsInvalidRange() {
    Professional p = new Professional();
    p.setId(10L);
    p.setTenant(tenant);
    p.setFullName("Ana");
    p.setActive(true);
    lenient().when(professionalRepository.findByIdAndTenant_Id(10L, 1L)).thenReturn(Optional.of(p));

    var schedules =
        List.of(
            new ProfessionalScheduleRequest((short) 2, LocalTime.of(12, 0), LocalTime.of(12, 0)));

    assertThatThrownBy(() -> service.updateSchedules(1L, 10L, schedules))
        .isInstanceOf(ResponseStatusException.class);
  }

  @Test
  void updateSchedules_acceptsValidSchedule() {
    Professional p = new Professional();
    p.setId(10L);
    p.setTenant(tenant);
    p.setFullName("Ana");
    p.setActive(true);
    lenient().when(professionalRepository.findByIdAndTenant_Id(10L, 1L)).thenReturn(Optional.of(p));

    var saved =
        List.of(
            new ProfessionalScheduleRequest((short) 1, LocalTime.of(9, 0), LocalTime.of(17, 0)));
    lenient()
        .when(professionalScheduleRepository.findByProfessionalIdOrderByDayOfWeekAscIdAsc(10L))
        .thenReturn(List.of());

    var res = service.updateSchedules(1L, 10L, saved);
    assertThat(res.active()).isTrue();
  }

  @Test
  void deactivate_setsActiveFalse() {
    Professional p = new Professional();
    p.setId(10L);
    p.setTenant(tenant);
    p.setFullName("Ana");
    p.setActive(true);
    lenient().when(professionalRepository.findByIdAndTenant_Id(10L, 1L)).thenReturn(Optional.of(p));
    lenient()
        .when(professionalScheduleRepository.findByProfessionalIdOrderByDayOfWeekAscIdAsc(10L))
        .thenReturn(List.of());

    var res = service.deactivate(1L, 10L);
    assertThat(res.active()).isFalse();
  }
}
