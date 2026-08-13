package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.TenantSifenHomologationStatus;
import com.cursorpoc.backend.domain.enums.SifenHomologationStatus;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.repository.TenantSifenHomologationStatusRepository;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.Spy;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** RT-19 (Hardening_SIFEN.md). */
@ExtendWith(MockitoExtension.class)
class SifenHomologationStatusServiceTest {

  @Mock private TenantSifenHomologationStatusRepository repository;
  @Mock private TenantRepository tenantRepository;
  @Spy private FemmeTimeProperties timeProperties = new FemmeTimeProperties();

  @InjectMocks private SifenHomologationStatusService service;

  @Test
  void getStatus_returnsPendingWithNoMarker_whenNoRowEverRecorded() {
    when(tenantRepository.existsById(1L)).thenReturn(true);
    when(repository.findByTenantId(1L)).thenReturn(Optional.empty());

    var out = service.getStatus(1L);

    assertThat(out.status()).isEqualTo(SifenHomologationStatus.PENDING);
    assertThat(out.markedByEmail()).isNull();
    assertThat(out.markedAt()).isNull();
  }

  @Test
  void getStatus_returnsRecordedRow() {
    when(tenantRepository.existsById(1L)).thenReturn(true);
    TenantSifenHomologationStatus row = new TenantSifenHomologationStatus();
    row.setTenantId(1L);
    row.setStatus(SifenHomologationStatus.APPROVED);
    row.setMarkedByUserId(7L);
    row.setMarkedByEmail("root@pelu");
    row.setMarkedAt(java.time.LocalDateTime.of(2026, 8, 1, 10, 0));
    when(repository.findByTenantId(1L)).thenReturn(Optional.of(row));

    var out = service.getStatus(1L);

    assertThat(out.status()).isEqualTo(SifenHomologationStatus.APPROVED);
    assertThat(out.markedByEmail()).isEqualTo("root@pelu");
    assertThat(out.markedAt()).isNotNull();
  }

  @Test
  void getStatus_unknownTenant_throwsNotFound() {
    when(tenantRepository.existsById(2L)).thenReturn(false);

    assertThatThrownBy(() -> service.getStatus(2L))
        .isInstanceOf(ResponseStatusException.class)
        .extracting("statusCode")
        .isEqualTo(HttpStatus.NOT_FOUND);
  }

  @Test
  void setStatus_createsRow_whenNoneExists() {
    when(tenantRepository.existsById(1L)).thenReturn(true);
    when(repository.findByTenantId(1L)).thenReturn(Optional.empty());
    when(repository.save(any(TenantSifenHomologationStatus.class)))
        .thenAnswer(inv -> inv.getArgument(0));

    var out = service.setStatus(1L, SifenHomologationStatus.APPROVED, 7L, "root@pelu");

    assertThat(out.status()).isEqualTo(SifenHomologationStatus.APPROVED);
    assertThat(out.markedByEmail()).isEqualTo("root@pelu");
    assertThat(out.markedAt()).isNotNull();
  }

  @Test
  void setStatus_updatesExistingRow_overwritingPreviousMarker() {
    when(tenantRepository.existsById(1L)).thenReturn(true);
    TenantSifenHomologationStatus row = new TenantSifenHomologationStatus();
    row.setTenantId(1L);
    row.setStatus(SifenHomologationStatus.APPROVED);
    row.setMarkedByUserId(7L);
    row.setMarkedByEmail("root@pelu");
    row.setMarkedAt(java.time.LocalDateTime.of(2026, 8, 1, 10, 0));
    when(repository.findByTenantId(1L)).thenReturn(Optional.of(row));
    when(repository.save(any(TenantSifenHomologationStatus.class)))
        .thenAnswer(inv -> inv.getArgument(0));

    var out = service.setStatus(1L, SifenHomologationStatus.PENDING, 9L, "other@pelu");

    assertThat(out.status()).isEqualTo(SifenHomologationStatus.PENDING);
    assertThat(out.markedByEmail()).isEqualTo("other@pelu");
    assertThat(row.getMarkedByUserId()).isEqualTo(9L);
  }
}
