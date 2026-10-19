package com.cursorpoc.backend.repository;

import static org.assertj.core.api.Assertions.assertThat;

import com.cursorpoc.backend.domain.AppUser;
import com.cursorpoc.backend.domain.CashSession;
import com.cursorpoc.backend.domain.FiscalStamp;
import com.cursorpoc.backend.domain.Invoice;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.Tier;
import com.cursorpoc.backend.domain.enums.InvoiceStatus;
import com.cursorpoc.backend.domain.enums.SifenSubmissionStatus;
import com.cursorpoc.backend.domain.enums.UserRole;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

/**
 * Runs the real JPQL in {@link InvoiceRepository#findDueForSifenRetry} against the real JPA mapping
 * + H2 schema, proving what {@code SifenSubmissionReconcilerTest}'s mocked repository cannot: an
 * invoice pending in a lote with a scheduled poll is still recovered past {@code maxAttempts} (up
 * to {@code maxBatchAttempts}), while the plain retry cutoff is unchanged for everything else.
 */
@SpringBootTest
@ActiveProfiles("test")
@Transactional
class InvoiceRepositoryFindDueForSifenRetryTest {

  private static final List<SifenSubmissionStatus> RETRYABLE =
      List.of(SifenSubmissionStatus.QUEUED, SifenSubmissionStatus.PENDING_VERIFICATION);
  private static final int MAX_ATTEMPTS = 6;
  private static final int MAX_BATCH_ATTEMPTS = 57;

  @Autowired private TierRepository tierRepository;
  @Autowired private TenantRepository tenantRepository;
  @Autowired private AppUserRepository appUserRepository;
  @Autowired private FiscalStampRepository fiscalStampRepository;
  @Autowired private CashSessionRepository cashSessionRepository;
  @Autowired private InvoiceRepository invoiceRepository;

  private final LocalDateTime now = LocalDateTime.of(2026, 10, 16, 12, 0);
  private Tenant tenant;
  private FiscalStamp stamp;
  private CashSession session;
  private int nextNumber = 1;

  @BeforeEach
  void setUp() {
    Tier tier = new Tier();
    tier.setName("Tier " + System.nanoTime());
    tier = tierRepository.save(tier);
    tenant = new Tenant();
    tenant.setName("Tenant " + System.nanoTime());
    tenant.setTier(tier);
    tenant = tenantRepository.save(tenant);

    AppUser user = new AppUser();
    user.setTenant(tenant);
    user.setEmail("retry" + System.nanoTime() + "@example.com");
    user.setPasswordHash("irrelevant-hash-value");
    user.setRole(UserRole.ADMIN);
    user.setEnabled(true);
    user = appUserRepository.save(user);

    stamp = new FiscalStamp();
    stamp.setTenant(tenant);
    stamp.setStampNumber("ST-" + System.nanoTime());
    stamp.setValidFrom(LocalDate.of(2026, 1, 1));
    stamp.setRangeFrom(1);
    stamp.setNextEmissionNumber(1);
    stamp.setActive(true);
    stamp = fiscalStampRepository.save(stamp);

    session = new CashSession();
    session.setTenant(tenant);
    session.setOpenedByUser(user);
    session.setOpenedAt(Instant.now());
    session.setOpeningCashAmount(BigDecimal.ZERO);
    session = cashSessionRepository.save(session);
  }

  private Invoice persist(
      SifenSubmissionStatus status,
      String batchNumber,
      LocalDateTime nextAttemptAt,
      int attemptCount) {
    Invoice invoice = new Invoice();
    invoice.setTenant(tenant);
    invoice.setFiscalStamp(stamp);
    invoice.setCashSession(session);
    invoice.setInvoiceNumber(nextNumber++);
    invoice.setStatus(InvoiceStatus.ISSUED);
    invoice.setSubtotal(BigDecimal.TEN);
    invoice.setTotal(BigDecimal.TEN);
    invoice.setIssuedAt(Instant.now());
    invoice.setSifenSubmissionStatus(status);
    invoice.setSifenBatchNumber(batchNumber);
    invoice.setSifenNextAttemptAt(nextAttemptAt);
    invoice.setSifenAttemptCount(attemptCount);
    return invoiceRepository.save(invoice);
  }

  private List<Long> dueIds() {
    invoiceRepository.flush();
    return invoiceRepository
        .findDueForSifenRetry(
            RETRYABLE,
            now,
            now.minusMinutes(5),
            MAX_ATTEMPTS,
            SifenSubmissionStatus.PENDING_VERIFICATION,
            MAX_BATCH_ATTEMPTS)
        .stream()
        .filter(i -> i.getTenant().getId().equals(tenant.getId()))
        .map(Invoice::getId)
        .toList();
  }

  @Test
  void recoversALostLotePoll_pastMaxAttempts_upToMaxBatchAttempts() {
    Invoice lostPoll =
        persist(SifenSubmissionStatus.PENDING_VERIFICATION, "123", now.minusMinutes(1), 51);
    Invoice lastBatchAttempt =
        persist(SifenSubmissionStatus.PENDING_VERIFICATION, "123", now.minusMinutes(1), 56);
    Invoice batchAttemptsExhausted =
        persist(SifenSubmissionStatus.PENDING_VERIFICATION, "123", now.minusMinutes(1), 57);

    assertThat(dueIds())
        .contains(lostPoll.getId(), lastBatchAttempt.getId())
        .doesNotContain(batchAttemptsExhausted.getId());
  }

  @Test
  void skipsALote_whosePollingGaveUp_orWhosePollIsNotDueYet() {
    // Polling exhausted → the listener cleared sifenNextAttemptAt: never re-enqueued.
    Invoice gaveUp = persist(SifenSubmissionStatus.PENDING_VERIFICATION, "123", null, 51);
    // Scheduled poll (plus its safety margin) still in the future: the message isn't lost yet.
    Invoice notDue =
        persist(SifenSubmissionStatus.PENDING_VERIFICATION, "123", now.plusMinutes(1), 51);

    assertThat(dueIds()).doesNotContain(gaveUp.getId(), notDue.getId());
  }

  @Test
  void keepsTheMaxAttemptsCutoff_forInvoicesNotPendingInALote() {
    Invoice withinRetries =
        persist(SifenSubmissionStatus.PENDING_VERIFICATION, null, now.minusMinutes(1), 5);
    Invoice retriesExhausted =
        persist(SifenSubmissionStatus.PENDING_VERIFICATION, null, now.minusMinutes(1), 6);
    Invoice blankBatchNumber =
        persist(SifenSubmissionStatus.PENDING_VERIFICATION, "", now.minusMinutes(1), 6);
    Invoice queuedPastMax = persist(SifenSubmissionStatus.QUEUED, "123", now.minusMinutes(1), 6);

    assertThat(dueIds())
        .contains(withinRetries.getId())
        .doesNotContain(retriesExhausted.getId(), blankBatchNumber.getId(), queuedPastMax.getId());
  }
}
