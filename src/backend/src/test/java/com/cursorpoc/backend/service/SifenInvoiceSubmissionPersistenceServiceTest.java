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

  private SifenInvoiceSubmissionPersistenceService persistence;
  private Invoice invoice;

  @BeforeEach
  void setUp() {
    persistence =
        new SifenInvoiceSubmissionPersistenceService(invoiceRepository, new FemmeTimeProperties());
    invoice = new Invoice();
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
    invoice.setSifenProcessingStartedAt(LocalDateTime.now());
    when(invoiceRepository.lockByIdAndTenantId(INVOICE_ID, TENANT_ID))
        .thenReturn(Optional.of(invoice));

    Optional<Integer> claimed = persistence.claimForSubmission(TENANT_ID, INVOICE_ID, LEASE_TTL);

    assertThat(claimed).isEmpty();
    // Refusing to claim must not still increment the attempt count as a side effect.
    assertThat(invoice.getSifenAttemptCount()).isZero();
  }

  @Test
  void claimForSubmission_claims_whenThePreviousLeaseHasExpired() {
    invoice.setSifenProcessingStartedAt(LocalDateTime.now().minus(LEASE_TTL).minusSeconds(1));
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
}
