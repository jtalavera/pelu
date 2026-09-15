package com.cursorpoc.backend.service;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.SifenInvoiceEventLog;
import com.cursorpoc.backend.domain.enums.SifenInvoiceEventType;
import com.cursorpoc.backend.repository.SifenInvoiceEventLogRepository;
import com.cursorpoc.backend.web.dto.SifenInvoiceEventLogResponse;
import java.time.LocalDateTime;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Issue #205 AC-2: append-only log of every SIFEN interaction for an invoice, shared by the three
 * "single last result" write sites ({@code SifenInvoiceSubmissionPersistenceService}, {@code
 * SifenInvoiceCancellationService}, {@code SifenInvoiceClientIdentificationService}) so the invoice
 * detail's "Estado en SIFEN" accordion can show a full history instead of only the latest result
 * per concern.
 */
@Service
public class SifenInvoiceEventLogService {

  private final SifenInvoiceEventLogRepository repository;
  private final FemmeTimeProperties timeProperties;

  public SifenInvoiceEventLogService(
      SifenInvoiceEventLogRepository repository, FemmeTimeProperties timeProperties) {
    this.repository = repository;
    this.timeProperties = timeProperties;
  }

  @Transactional
  public void record(
      long tenantId,
      long invoiceId,
      SifenInvoiceEventType eventType,
      String resultCode,
      String message) {
    SifenInvoiceEventLog entry = new SifenInvoiceEventLog();
    entry.setTenantId(tenantId);
    entry.setInvoiceId(invoiceId);
    entry.setEventType(eventType);
    entry.setOccurredAt(LocalDateTime.now(timeProperties.zoneId()));
    entry.setResultCode(resultCode);
    entry.setMessage(message);
    repository.save(entry);
  }

  @Transactional(readOnly = true)
  public List<SifenInvoiceEventLogResponse> history(long tenantId, long invoiceId) {
    return repository.findByTenantIdAndInvoiceIdOrderByOccurredAtDesc(tenantId, invoiceId).stream()
        .map(
            e ->
                new SifenInvoiceEventLogResponse(
                    e.getEventType().name(),
                    e.getOccurredAt().atZone(timeProperties.zoneId()).toInstant(),
                    e.getResultCode(),
                    e.getMessage()))
        .toList();
  }
}
