package com.cursorpoc.backend.service;

import com.cursorpoc.backend.domain.enums.SifenSubmissionStatus;
import io.opentelemetry.api.OpenTelemetry;
import io.opentelemetry.api.common.AttributeKey;
import io.opentelemetry.api.common.Attributes;
import io.opentelemetry.api.metrics.DoubleHistogram;
import io.opentelemetry.api.metrics.LongCounter;
import io.opentelemetry.api.metrics.Meter;
import java.math.BigDecimal;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * Issue #268: business counters behind the per-environment "business" Application Insights workbook
 * (appointments, invoicing/SIFEN, tenant/user activity). Exported to {@code customMetrics} by the
 * Application Insights Java agent; a no-op without it (see {@code OpenTelemetryConfig}).
 *
 * <p>Cardinality discipline (same as {@link SifenCallMetrics}): attributes are bounded IDs/enums
 * only — {@code tenantId}, {@code professionalId}, {@code serviceId}, {@code outcome}, {@code
 * status}. Never invoice/appointment/client IDs, never names or emails.
 *
 * <p>Every recording made inside an active transaction is deferred to {@code afterCommit}, so a
 * rolled-back create/issue is never counted.
 */
@Service
public class BusinessMetrics {

  /** Instrumentation scope for every custom instrument this app defines. */
  public static final String METER_NAME = "femme";

  static final AttributeKey<String> TENANT_ID = AttributeKey.stringKey("tenantId");
  static final AttributeKey<String> PROFESSIONAL_ID = AttributeKey.stringKey("professionalId");
  static final AttributeKey<String> SERVICE_ID = AttributeKey.stringKey("serviceId");
  static final AttributeKey<String> OUTCOME = AttributeKey.stringKey("outcome");
  static final AttributeKey<String> STATUS = AttributeKey.stringKey("status");

  /** {@code tenantId} value for a platform-admin login (no tenant). */
  public static final String TENANT_PLATFORM = "platform";

  /** {@code tenantId} value when a failed login can't be attributed to a tenant. */
  public static final String TENANT_UNKNOWN = "unknown";

  private final LongCounter appointmentCreated;
  private final LongCounter appointmentCancelled;
  private final LongCounter appointmentNoShow;
  private final DoubleHistogram invoiceIssued;
  private final LongCounter sifenResult;
  private final LongCounter tenantCreated;
  private final LongCounter authLogin;

  public BusinessMetrics(OpenTelemetry openTelemetry) {
    Meter meter = openTelemetry.getMeter(METER_NAME);
    this.appointmentCreated =
        meter
            .counterBuilder("femme.appointment.created")
            .setDescription("Appointments booked")
            .build();
    this.appointmentCancelled =
        meter
            .counterBuilder("femme.appointment.cancelled")
            .setDescription("Appointments moved to CANCELLED")
            .build();
    this.appointmentNoShow =
        meter
            .counterBuilder("femme.appointment.no_show")
            .setDescription("Appointments moved to NO_SHOW")
            .build();
    // A histogram rather than a counter: its count is the number of invoices issued and its sum
    // is the amount invoiced (Gs.), both from one instrument (valueCount / valueSum in
    // customMetrics).
    this.invoiceIssued =
        meter
            .histogramBuilder("femme.invoice.issued")
            .setUnit("PYG")
            .setDescription("Invoices issued; value = invoice total")
            .build();
    this.sifenResult =
        meter
            .counterBuilder("femme.sifen.result")
            .setDescription("Final SIFEN verdicts on submitted DEs, by status")
            .build();
    this.tenantCreated =
        meter.counterBuilder("femme.tenant.created").setDescription("Tenants provisioned").build();
    this.authLogin =
        meter
            .counterBuilder("femme.auth.login")
            .setDescription("Login attempts by outcome")
            .build();
  }

  public void appointmentCreated(long tenantId, Long professionalId, Long serviceId) {
    Attributes attributes = appointmentAttributes(tenantId, professionalId, serviceId);
    afterCommit(() -> appointmentCreated.add(1, attributes));
  }

  public void appointmentCancelled(long tenantId, Long professionalId, Long serviceId) {
    Attributes attributes = appointmentAttributes(tenantId, professionalId, serviceId);
    afterCommit(() -> appointmentCancelled.add(1, attributes));
  }

  public void appointmentNoShow(long tenantId, Long professionalId, Long serviceId) {
    Attributes attributes = appointmentAttributes(tenantId, professionalId, serviceId);
    afterCommit(() -> appointmentNoShow.add(1, attributes));
  }

  public void invoiceIssued(long tenantId, BigDecimal total) {
    double amount = total == null ? 0d : total.doubleValue();
    Attributes attributes = Attributes.of(TENANT_ID, String.valueOf(tenantId));
    afterCommit(() -> invoiceIssued.record(amount, attributes));
  }

  /** Only final verdicts are counted; QUEUED/PENDING_VERIFICATION/CANCELLED/null are ignored. */
  public void sifenResult(long tenantId, SifenSubmissionStatus status) {
    if (status != SifenSubmissionStatus.APPROVED
        && status != SifenSubmissionStatus.APPROVED_WITH_OBSERVATION
        && status != SifenSubmissionStatus.REJECTED) {
      return;
    }
    Attributes attributes =
        Attributes.of(TENANT_ID, String.valueOf(tenantId), STATUS, status.name());
    afterCommit(() -> sifenResult.add(1, attributes));
  }

  public void tenantCreated() {
    afterCommit(() -> tenantCreated.add(1));
  }

  /**
   * @param outcome {@code success}, {@code invalid_credentials} or {@code tenant_ambiguous}
   * @param tenant the tenant ID, or {@link #TENANT_PLATFORM} / {@link #TENANT_UNKNOWN}
   */
  public void login(String outcome, String tenant) {
    // Not deferred: a failed login throws (rolling back any transaction), and that attempt is
    // exactly what must be counted.
    authLogin.add(1, Attributes.of(OUTCOME, outcome, TENANT_ID, tenant));
  }

  private static Attributes appointmentAttributes(
      long tenantId, Long professionalId, Long serviceId) {
    return Attributes.of(
        TENANT_ID,
        String.valueOf(tenantId),
        PROFESSIONAL_ID,
        String.valueOf(professionalId),
        SERVICE_ID,
        String.valueOf(serviceId));
  }

  private static void afterCommit(Runnable recording) {
    if (TransactionSynchronizationManager.isSynchronizationActive()) {
      TransactionSynchronizationManager.registerSynchronization(
          new TransactionSynchronization() {
            @Override
            public void afterCommit() {
              recording.run();
            }
          });
    } else {
      recording.run();
    }
  }
}
