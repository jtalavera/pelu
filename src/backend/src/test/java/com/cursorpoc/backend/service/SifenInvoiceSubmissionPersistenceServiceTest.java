package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.Invoice;
import com.cursorpoc.backend.repository.InvoiceRepository;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

/**
 * RT-20 (Hardening_SIFEN.md). {@link SifenInvoiceSubmissionPersistenceService#claimForSubmission}
 * ultimately relies on {@code InvoiceRepository#lockByIdAndTenantId}'s {@code PESSIMISTIC_WRITE}
 * row lock to make two truly concurrent claims mutually exclusive — that database-level guarantee
 * isn't something a Mockito test can prove (it would need two real transactions racing against a
 * shared H2 instance). What's tested here is the conditional logic a single claim applies once it
 * holds that lock: is the existing lease expired, and does a successful claim increment the attempt
 * count exactly once.
 */
@ExtendWith(MockitoExtension.class)
class SifenInvoiceSubmissionPersistenceServiceTest {

  private static final long TENANT_ID = 1L;
  private static final long INVOICE_ID = 100L;
  private static final Duration LEASE_TTL = Duration.ofMinutes(5);

  @Mock private InvoiceRepository invoiceRepository;

  private final FemmeTimeProperties timeProperties = new FemmeTimeProperties();
  private SifenInvoiceSubmissionPersistenceService persistence;
  private Invoice invoice;

  @BeforeEach
  void setUp() {
    persistence = new SifenInvoiceSubmissionPersistenceService(invoiceRepository, timeProperties);
    invoice = new Invoice();
  }

  /**
   * {@code claimForSubmission} compares against {@code LocalDateTime.now(timeProperties.zoneId())}
   * (business zone, {@code America/Asuncion} by default), not the JVM's default zone — a bare
   * {@code LocalDateTime.now()} here only agreed with it by coincidence on a machine whose system
   * zone happens to also be America/Asuncion, and silently disagreed (by the zone offset, several
   * hours) on CI runners defaulting to UTC, flipping the lease-expiry comparison. Real bug, found
   * by a CI-only failure of {@code claimForSubmission_claims_whenThePreviousLeaseHasExpired} that
   * never reproduced locally.
   */
  private LocalDateTime businessNow() {
    return LocalDateTime.now(timeProperties.zoneId());
  }

  @Test
  void claimForSubmission_claimsAndIncrementsAttempt_whenNeverClaimedBefore() {
    when(invoiceRepository.lockByIdAndTenantId(INVOICE_ID, TENANT_ID))
        .thenReturn(Optional.of(invoice));

    Optional<Integer> claimed = persistence.claimForSubmission(TENANT_ID, INVOICE_ID, LEASE_TTL);

    assertThat(claimed).contains(1);
    assertThat(invoice.getSifenAttemptCount()).isEqualTo(1);
    assertThat(invoice.getSifenProcessingStartedAt()).isNotNull();
  }

  @Test
  void claimForSubmission_incrementsFurther_onASecondClaimAfterRelease() {
    when(invoiceRepository.lockByIdAndTenantId(INVOICE_ID, TENANT_ID))
        .thenReturn(Optional.of(invoice));
    when(invoiceRepository.findByIdAndTenant_Id(INVOICE_ID, TENANT_ID))
        .thenReturn(Optional.of(invoice));
    persistence.claimForSubmission(TENANT_ID, INVOICE_ID, LEASE_TTL);
    persistence.releaseLease(TENANT_ID, INVOICE_ID);

    Optional<Integer> secondClaim =
        persistence.claimForSubmission(TENANT_ID, INVOICE_ID, LEASE_TTL);

    assertThat(secondClaim).contains(2);
    assertThat(invoice.getSifenAttemptCount()).isEqualTo(2);
  }

  @Test
  void claimForSubmission_refusesToClaim_whenAnUnexpiredLeaseIsAlreadyHeld() {
    invoice.setSifenProcessingStartedAt(businessNow());
    when(invoiceRepository.lockByIdAndTenantId(INVOICE_ID, TENANT_ID))
        .thenReturn(Optional.of(invoice));

    Optional<Integer> claimed = persistence.claimForSubmission(TENANT_ID, INVOICE_ID, LEASE_TTL);

    assertThat(claimed).isEmpty();
    // Refusing to claim must not still increment the attempt count as a side effect.
    assertThat(invoice.getSifenAttemptCount()).isZero();
  }

  @Test
  void claimForSubmission_claims_whenThePreviousLeaseHasExpired() {
    invoice.setSifenProcessingStartedAt(businessNow().minus(LEASE_TTL).minusSeconds(1));
    when(invoiceRepository.lockByIdAndTenantId(INVOICE_ID, TENANT_ID))
        .thenReturn(Optional.of(invoice));

    Optional<Integer> claimed = persistence.claimForSubmission(TENANT_ID, INVOICE_ID, LEASE_TTL);

    assertThat(claimed).contains(1);
  }

  @Test
  void releaseLease_clearsTheProcessingStartedAtMarker() {
    invoice.setSifenProcessingStartedAt(LocalDateTime.now());
    when(invoiceRepository.findByIdAndTenant_Id(INVOICE_ID, TENANT_ID))
        .thenReturn(Optional.of(invoice));

    persistence.releaseLease(TENANT_ID, INVOICE_ID);

    assertThat(invoice.getSifenProcessingStartedAt()).isNull();
  }

  @Test
  void scheduleRetry_thenClearRetrySchedule_roundTrips() {
    when(invoiceRepository.findByIdAndTenant_Id(INVOICE_ID, TENANT_ID))
        .thenReturn(Optional.of(invoice));
    LocalDateTime nextAttempt = LocalDateTime.now().plusMinutes(5);

    persistence.scheduleRetry(TENANT_ID, INVOICE_ID, nextAttempt);
    assertThat(invoice.getSifenNextAttemptAt()).isEqualTo(nextAttempt);

    persistence.clearRetrySchedule(TENANT_ID, INVOICE_ID);
    assertThat(invoice.getSifenNextAttemptAt()).isNull();
  }

  @Test
  void markQueued_setsStatusToQueued() {
    when(invoiceRepository.findByIdAndTenant_Id(INVOICE_ID, TENANT_ID))
        .thenReturn(Optional.of(invoice));

    persistence.markQueued(TENANT_ID, INVOICE_ID);

    assertThat(invoice.getSifenSubmissionStatus())
        .isEqualTo(com.cursorpoc.backend.domain.enums.SifenSubmissionStatus.QUEUED);
  }

  /** Issue #175: resetForCorrection wipes the SIFEN result but keeps the CDC/security code. */
  @Test
  void resetForCorrection_clearsResultFields_butKeepsCdcAndSecurityCode() {
    invoice.setSifenSubmissionStatus(
        com.cursorpoc.backend.domain.enums.SifenSubmissionStatus.REJECTED);
    invoice.setSifenControlNumber("01" + "4".repeat(42));
    invoice.setSifenSecurityCode("987654321");
    invoice.setSifenSubmissionProtocolNumber("111");
    invoice.setSifenSubmissionResultCode("400");
    invoice.setSifenSubmissionMessage("XML mal formado");
    invoice.setSifenSubmittedAt(businessNow());
    invoice.setSifenSignedAt(businessNow().minusHours(1));
    invoice.setSifenAttemptCount(3);
    invoice.setSifenNextAttemptAt(businessNow());
    invoice.setSifenProcessingStartedAt(businessNow());
    when(invoiceRepository.findByIdAndTenant_Id(INVOICE_ID, TENANT_ID))
        .thenReturn(Optional.of(invoice));

    persistence.resetForCorrection(TENANT_ID, INVOICE_ID);

    assertThat(invoice.getSifenSubmissionStatus()).isNull();
    assertThat(invoice.getSifenSubmissionProtocolNumber()).isNull();
    assertThat(invoice.getSifenSubmissionResultCode()).isNull();
    assertThat(invoice.getSifenSubmissionMessage()).isNull();
    assertThat(invoice.getSifenSubmittedAt()).isNull();
    assertThat(invoice.getSifenSignedAt()).isNull();
    assertThat(invoice.getSifenAttemptCount()).isZero();
    assertThat(invoice.getSifenNextAttemptAt()).isNull();
    assertThat(invoice.getSifenProcessingStartedAt()).isNull();
    // CDC survives — same-number correction (Manual Técnico V150 §6.5).
    assertThat(invoice.getSifenControlNumber()).isEqualTo("01" + "4".repeat(42));
    assertThat(invoice.getSifenSecurityCode()).isEqualTo("987654321");
  }

  @Test
  void resetForCorrection_rejectsAnInvoiceThatIsNotRejected() {
    invoice.setSifenSubmissionStatus(
        com.cursorpoc.backend.domain.enums.SifenSubmissionStatus.APPROVED);
    when(invoiceRepository.findByIdAndTenant_Id(INVOICE_ID, TENANT_ID))
        .thenReturn(Optional.of(invoice));

    org.assertj.core.api.Assertions.assertThatThrownBy(
            () -> persistence.resetForCorrection(TENANT_ID, INVOICE_ID))
        .isInstanceOf(org.springframework.web.server.ResponseStatusException.class)
        .hasMessageContaining("INVOICE_NOT_REJECTED");
  }
}
