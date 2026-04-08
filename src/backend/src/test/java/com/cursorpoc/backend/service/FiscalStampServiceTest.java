package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.domain.FiscalStamp;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.repository.FiscalStampRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.web.dto.FiscalStampCreateRequest;
import com.cursorpoc.backend.web.dto.FiscalStampUpdateRequest;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.web.server.ResponseStatusException;

@ExtendWith(MockitoExtension.class)
class FiscalStampServiceTest {

  @Mock private TenantRepository tenantRepository;
  @Mock private FiscalStampRepository fiscalStampRepository;

  @InjectMocks private FiscalStampService service;

  private Tenant tenant;

  @BeforeEach
  void setUp() {
    tenant = new Tenant();
    tenant.setId(1L);
    tenant.setName("T");
  }

  @Test
  void create_stripsNonDigitsRejected() {
    when(tenantRepository.findById(1L)).thenReturn(Optional.of(tenant));
    var req =
        new FiscalStampCreateRequest(
            "12a34",
            LocalDate.of(2025, 1, 1),
            LocalDate.of(2026, 1, 1),
            1,
            100,
            1);
    assertThatThrownBy(() -> service.create(1L, req)).isInstanceOf(ResponseStatusException.class);
  }

  @Test
  void create_persistsDigitsOnlyStampNumber() {
    when(tenantRepository.findById(1L)).thenReturn(Optional.of(tenant));
    when(fiscalStampRepository.save(any(FiscalStamp.class)))
        .thenAnswer(
            inv -> {
              FiscalStamp s = inv.getArgument(0);
              s.setId(99L);
              return s;
            });
    var req =
        new FiscalStampCreateRequest(
            " 12345 ",
            LocalDate.of(2025, 1, 1),
            LocalDate.of(2026, 1, 1),
            10,
            100,
            50);
    var dto = service.create(1L, req);
    assertThat(dto.stampNumber()).isEqualTo("12345");
    assertThat(dto.active()).isFalse();

    ArgumentCaptor<FiscalStamp> cap = ArgumentCaptor.forClass(FiscalStamp.class);
    verify(fiscalStampRepository).save(cap.capture());
    assertThat(cap.getValue().getStampNumber()).isEqualTo("12345");
  }

  @Test
  void create_rejectsInitialEmissionOutsideRange() {
    when(tenantRepository.findById(1L)).thenReturn(Optional.of(tenant));
    var req =
        new FiscalStampCreateRequest(
            "1",
            LocalDate.of(2025, 1, 1),
            LocalDate.of(2026, 1, 1),
            10,
            20,
            5);
    assertThatThrownBy(() -> service.create(1L, req)).isInstanceOf(ResponseStatusException.class);
  }

  @Test
  void create_rejectsEndBeforeStart() {
    when(tenantRepository.findById(1L)).thenReturn(Optional.of(tenant));
    var req =
        new FiscalStampCreateRequest(
            "1",
            LocalDate.of(2026, 1, 1),
            LocalDate.of(2025, 1, 1),
            1,
            10,
            1);
    assertThatThrownBy(() -> service.create(1L, req)).isInstanceOf(ResponseStatusException.class);
  }

  @Test
  void update_rejectsWhenLocked() {
    FiscalStamp s = new FiscalStamp();
    s.setId(3L);
    s.setTenant(tenant);
    s.setStampNumber("1");
    s.setValidFrom(LocalDate.of(2025, 1, 1));
    s.setValidUntil(LocalDate.of(2027, 1, 1));
    s.setRangeFrom(1);
    s.setRangeTo(100);
    s.setNextEmissionNumber(5);
    s.setLockedAfterInvoice(true);
    when(fiscalStampRepository.findById(3L)).thenReturn(Optional.of(s));

    var req =
        new FiscalStampUpdateRequest(
            LocalDate.of(2025, 1, 1), LocalDate.of(2027, 1, 1), 5);
    assertThatThrownBy(() -> service.update(1L, 3L, req))
        .isInstanceOf(ResponseStatusException.class);
  }

  @Test
  void activate_setsOnlyOneActive() {
    FiscalStamp a = stamp(1L, false);
    FiscalStamp b = stamp(2L, false);
    when(fiscalStampRepository.findByTenant_IdOrderByIdAsc(1L)).thenReturn(List.of(a, b));
    when(fiscalStampRepository.findById(2L)).thenReturn(Optional.of(b));

    service.activate(1L, 2L);

    assertThat(a.isActive()).isFalse();
    assertThat(b.isActive()).isTrue();
  }

  private static FiscalStamp stamp(long id, boolean active) {
    Tenant t = new Tenant();
    t.setId(1L);
    FiscalStamp s = new FiscalStamp();
    s.setId(id);
    s.setTenant(t);
    s.setStampNumber("1");
    s.setValidFrom(LocalDate.of(2025, 1, 1));
    s.setValidUntil(LocalDate.of(2027, 1, 1));
    s.setRangeFrom(1);
    s.setRangeTo(10);
    s.setNextEmissionNumber(1);
    s.setActive(active);
    s.setLockedAfterInvoice(false);
    return s;
  }
}
