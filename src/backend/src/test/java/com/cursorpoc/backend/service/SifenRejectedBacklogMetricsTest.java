package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.repository.InvoiceRepository;
import io.opentelemetry.api.common.Attributes;
import java.util.List;
import org.junit.jupiter.api.Test;

/** Issue #268. */
class SifenRejectedBacklogMetricsTest {

  private final InMemoryTelemetry telemetry = new InMemoryTelemetry();
  private final InvoiceRepository invoiceRepository = mock(InvoiceRepository.class);
  private final SifenRejectedBacklogMetrics backlog =
      new SifenRejectedBacklogMetrics(invoiceRepository, telemetry.openTelemetry());

  @Test
  void refresh_publishesTheBacklogPerTenant_andZeroForATenantThatCleared() {
    when(invoiceRepository.countSifenRejectedUnresolvedByTenant(any(), any(), anyList()))
        .thenReturn(List.of(new Object[] {1L, 3L}, new Object[] {2L, 1L}))
        .thenReturn(List.<Object[]>of(new Object[] {1L, 2L}));

    backlog.refresh();
    assertThat(gauge("1")).isEqualTo(3L);
    assertThat(gauge("2")).isEqualTo(1L);

    backlog.refresh();
    assertThat(gauge("1")).isEqualTo(2L);
    assertThat(gauge("2")).isZero();
  }

  @Test
  void refresh_keepsThePreviousSnapshot_whenTheQueryFails() {
    when(invoiceRepository.countSifenRejectedUnresolvedByTenant(any(), any(), anyList()))
        .thenReturn(List.<Object[]>of(new Object[] {1L, 3L}))
        .thenThrow(new IllegalStateException("db down"));

    backlog.refresh();
    backlog.refresh();

    assertThat(gauge("1")).isEqualTo(3L);
  }

  private long gauge(String tenantId) {
    return telemetry
        .gaugeValue(
            SifenRejectedBacklogMetrics.METRIC_NAME,
            Attributes.of(BusinessMetrics.TENANT_ID, tenantId))
        .orElseThrow();
  }
}
