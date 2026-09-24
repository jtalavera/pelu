package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.cursorpoc.backend.domain.enums.SifenSubmissionStatus;
import io.opentelemetry.api.common.Attributes;
import java.math.BigDecimal;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/** Issue #268. */
class BusinessMetricsTest {

  private final InMemoryTelemetry telemetry = new InMemoryTelemetry();
  private final BusinessMetrics metrics = new BusinessMetrics(telemetry.openTelemetry());

  @AfterEach
  void clearSynchronization() {
    if (TransactionSynchronizationManager.isSynchronizationActive()) {
      TransactionSynchronizationManager.clearSynchronization();
    }
  }

  @Test
  void appointmentCounters_areTaggedByTenantProfessionalAndService() {
    metrics.appointmentCreated(1L, 10L, 20L);
    metrics.appointmentCreated(1L, 10L, 20L);
    metrics.appointmentCancelled(1L, 10L, 20L);
    metrics.appointmentNoShow(2L, 11L, 21L);

    assertThat(telemetry.counterValue("femme.appointment.created", appointment("1", "10", "20")))
        .isEqualTo(2);
    assertThat(telemetry.counterValue("femme.appointment.cancelled", appointment("1", "10", "20")))
        .isEqualTo(1);
    assertThat(telemetry.counterValue("femme.appointment.no_show", appointment("2", "11", "21")))
        .isEqualTo(1);
  }

  @Test
  void invoiceIssued_recordsCountAndAmountInOneHistogram() {
    metrics.invoiceIssued(1L, new BigDecimal("150000.00"));
    metrics.invoiceIssued(1L, new BigDecimal("50000.00"));

    assertThat(
            telemetry.histogramPoints(
                "femme.invoice.issued", Attributes.of(BusinessMetrics.TENANT_ID, "1")))
        .singleElement()
        .satisfies(
            p -> {
              assertThat(p.getCount()).isEqualTo(2);
              assertThat(p.getSum()).isEqualTo(200_000d);
            });
  }

  @Test
  void sifenResult_countsOnlyFinalVerdicts() {
    metrics.sifenResult(1L, SifenSubmissionStatus.APPROVED);
    metrics.sifenResult(1L, SifenSubmissionStatus.REJECTED);
    metrics.sifenResult(1L, SifenSubmissionStatus.PENDING_VERIFICATION);
    metrics.sifenResult(1L, SifenSubmissionStatus.QUEUED);
    metrics.sifenResult(1L, null);

    assertThat(telemetry.counterValue("femme.sifen.result", sifen("1", "APPROVED"))).isEqualTo(1);
    assertThat(telemetry.counterValue("femme.sifen.result", sifen("1", "REJECTED"))).isEqualTo(1);
    assertThat(telemetry.counterValue("femme.sifen.result", sifen("1", "PENDING_VERIFICATION")))
        .isZero();
  }

  @Test
  void recordingsInsideATransaction_areDeferredUntilCommit() {
    TransactionSynchronizationManager.initSynchronization();

    metrics.tenantCreated();
    metrics.appointmentCreated(1L, 10L, 20L);

    assertThat(telemetry.counterValue("femme.tenant.created", Attributes.empty())).isZero();

    TransactionSynchronizationManager.getSynchronizations()
        .forEach(TransactionSynchronization::afterCommit);

    assertThat(telemetry.counterValue("femme.tenant.created", Attributes.empty())).isEqualTo(1);
    assertThat(telemetry.counterValue("femme.appointment.created", appointment("1", "10", "20")))
        .isEqualTo(1);
  }

  @Test
  void recordingsInsideARolledBackTransaction_areNeverEmitted() {
    TransactionSynchronizationManager.initSynchronization();

    metrics.invoiceIssued(1L, BigDecimal.TEN);
    TransactionSynchronizationManager.getSynchronizations()
        .forEach(s -> s.afterCompletion(TransactionSynchronization.STATUS_ROLLED_BACK));

    assertThat(
            telemetry.histogramPoints(
                "femme.invoice.issued", Attributes.of(BusinessMetrics.TENANT_ID, "1")))
        .isEmpty();
  }

  @Test
  void login_isRecordedImmediately_evenInsideATransaction() {
    TransactionSynchronizationManager.initSynchronization();

    metrics.login("invalid_credentials", BusinessMetrics.TENANT_UNKNOWN);

    assertThat(
            telemetry.counterValue(
                "femme.auth.login",
                Attributes.of(
                    BusinessMetrics.OUTCOME,
                    "invalid_credentials",
                    BusinessMetrics.TENANT_ID,
                    BusinessMetrics.TENANT_UNKNOWN)))
        .isEqualTo(1);
  }

  private static Attributes appointment(String tenantId, String professionalId, String serviceId) {
    return Attributes.of(
        BusinessMetrics.TENANT_ID,
        tenantId,
        BusinessMetrics.PROFESSIONAL_ID,
        professionalId,
        BusinessMetrics.SERVICE_ID,
        serviceId);
  }

  private static Attributes sifen(String tenantId, String status) {
    return Attributes.of(BusinessMetrics.TENANT_ID, tenantId, BusinessMetrics.STATUS, status);
  }
}
