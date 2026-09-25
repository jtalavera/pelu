package com.cursorpoc.backend.service;

import com.cursorpoc.backend.domain.enums.InvoiceStatus;
import com.cursorpoc.backend.domain.enums.SifenNumberVoidingStatus;
import com.cursorpoc.backend.domain.enums.SifenSubmissionStatus;
import com.cursorpoc.backend.repository.InvoiceRepository;
import io.opentelemetry.api.OpenTelemetry;
import io.opentelemetry.api.common.Attributes;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Issue #268: {@code femme.sifen.rejected_unresolved} — an observable gauge of the SIFEN-rejected
 * invoices still awaiting resolution (correct &amp; resend, void, or numbering inutilizada), per
 * {@code tenantId}, for the business workbook's backlog tile.
 *
 * <p>The gauge callback never touches the database (it runs on the exporter's thread every export
 * interval): it reads a snapshot this class refreshes on its own {@link Scheduled} cadence with one
 * grouped query. A tenant whose backlog drops to zero keeps reporting 0 rather than vanishing, so
 * the workbook's "latest value" reads correctly.
 */
@Component
public class SifenRejectedBacklogMetrics {

  private static final Logger log = LoggerFactory.getLogger(SifenRejectedBacklogMetrics.class);

  static final String METRIC_NAME = "femme.sifen.rejected_unresolved";

  private static final long REFRESH_INTERVAL_MILLIS = 5 * 60_000L;

  private final InvoiceRepository invoiceRepository;
  private final AtomicReference<Map<String, Long>> snapshot = new AtomicReference<>(Map.of());

  public SifenRejectedBacklogMetrics(
      InvoiceRepository invoiceRepository, OpenTelemetry openTelemetry) {
    this.invoiceRepository = invoiceRepository;
    openTelemetry
        .getMeter(BusinessMetrics.METER_NAME)
        .gaugeBuilder(METRIC_NAME)
        .ofLongs()
        .setDescription("SIFEN-rejected invoices not yet corrected, voided or inutilizadas")
        .buildWithCallback(
            measurement ->
                snapshot
                    .get()
                    .forEach(
                        (tenantId, count) ->
                            measurement.record(
                                count, Attributes.of(BusinessMetrics.TENANT_ID, tenantId))));
  }

  @Scheduled(initialDelay = 30_000L, fixedDelay = REFRESH_INTERVAL_MILLIS)
  @Transactional(readOnly = true)
  public void refresh() {
    try {
      List<Object[]> rows =
          invoiceRepository.countSifenRejectedUnresolvedByTenant(
              SifenSubmissionStatus.REJECTED,
              InvoiceStatus.VOIDED,
              List.of(
                  SifenNumberVoidingStatus.APPROVED,
                  SifenNumberVoidingStatus.APPROVED_WITH_OBSERVATION));
      Map<String, Long> next = new HashMap<>();
      snapshot.get().keySet().forEach(tenantId -> next.put(tenantId, 0L));
      for (Object[] row : rows) {
        next.put(String.valueOf(row[0]), ((Number) row[1]).longValue());
      }
      snapshot.set(Map.copyOf(next));
    } catch (RuntimeException e) {
      // Telemetry must never break the app — keep the previous snapshot and try again next tick.
      log.warn("Could not refresh {}: {}", METRIC_NAME, e.getMessage());
    }
  }
}
