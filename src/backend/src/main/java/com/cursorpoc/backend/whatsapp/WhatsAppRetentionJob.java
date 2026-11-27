package com.cursorpoc.backend.whatsapp;

import com.cursorpoc.backend.domain.WhatsAppMessage;
import com.cursorpoc.backend.repository.WhatsAppMessageRepository;
import com.cursorpoc.backend.util.PhoneNumberNormalizer;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * HU-WAP-07 (criterio 9): after the retention period (default 90 days) the full recipient number is
 * masked and the email fallback address and the stored variables are dropped, leaving the counts
 * (template, purpose, status, timestamps) for cost control.
 */
@Component
public class WhatsAppRetentionJob {

  private static final Logger log = LoggerFactory.getLogger(WhatsAppRetentionJob.class);
  private static final int BATCH = 200;

  private final WhatsAppMessageRepository messages;
  private final int retentionDays;
  private final TransactionTemplate tx;

  public WhatsAppRetentionJob(
      WhatsAppMessageRepository messages,
      PlatformTransactionManager transactionManager,
      @Value("${app.femme.whatsapp.retention-days:90}") int retentionDays) {
    this.messages = messages;
    this.retentionDays = retentionDays;
    this.tx = new TransactionTemplate(transactionManager);
  }

  @Scheduled(cron = "${app.femme.whatsapp.retention-cron:0 30 3 * * *}")
  public void run() {
    runBefore(Instant.now().minus(Duration.ofDays(retentionDays)));
  }

  /** Masks every message queued before {@code cutoff}. Returns how many were masked. */
  public int runBefore(Instant cutoff) {
    int total = 0;
    int n;
    do {
      n = maskBatch(cutoff);
      total += n;
    } while (n == BATCH);
    if (total > 0) {
      log.info("WHATSAPP retention masked {} messages", total);
    }
    return total;
  }

  /** One short transaction per batch (a plain call to a @Transactional method would not apply). */
  private int maskBatch(Instant cutoff) {
    Integer n =
        tx.execute(
            status -> {
              List<WhatsAppMessage> rows = messages.findToMask(cutoff, PageRequest.of(0, BATCH));
              Instant now = Instant.now();
              for (WhatsAppMessage m : rows) {
                m.setRecipient(PhoneNumberNormalizer.mask(m.getRecipient()));
                m.setFallbackEmail(null);
                m.setPayload("{}");
                m.setRecipientMaskedAt(now);
              }
              return rows.size();
            });
    return n == null ? 0 : n;
  }
}
