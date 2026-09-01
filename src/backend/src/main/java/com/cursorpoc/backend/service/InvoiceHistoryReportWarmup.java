package com.cursorpoc.backend.service;

import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/**
 * Issue #181: the first "Historial de comprobantes" report download was noticeably slower than
 * later ones. The cost is one-time class loading / static init — Apache POI + its XML stack for the
 * {@code .xlsx} path, OpenPDF's AFM font loading for the PDF path — paid on whichever request hits
 * it first.
 *
 * <p>This renders one tiny throwaway report of each kind on a background daemon thread right after
 * the app is ready, so that cost is paid at startup (off the request path, without delaying boot)
 * instead of by the first user who clicks "Descargar reporte".
 */
@Component
public class InvoiceHistoryReportWarmup {

  private static final Logger log = LoggerFactory.getLogger(InvoiceHistoryReportWarmup.class);

  private final InvoiceHistoryReportService reportService;
  private final boolean enabled;

  public InvoiceHistoryReportWarmup(
      InvoiceHistoryReportService reportService,
      @Value("${femme.report.warmup.enabled:true}") boolean enabled) {
    this.reportService = reportService;
    this.enabled = enabled;
  }

  @EventListener(ApplicationReadyEvent.class)
  public void warmUp() {
    if (!enabled) {
      return;
    }
    Thread thread =
        new Thread(
            () -> {
              try {
                long start = System.nanoTime();
                reportService.renderXlsx(List.of(), null, null);
                reportService.renderPdf(List.of(), null, null);
                log.info(
                    "Invoice-history report engine warmed up in {} ms",
                    (System.nanoTime() - start) / 1_000_000);
              } catch (RuntimeException e) {
                // Warm-up is best-effort — a failure here must never affect the running app.
                log.warn("Invoice-history report warm-up failed (non-fatal)", e);
              }
            },
            "invoice-report-warmup");
    thread.setDaemon(true);
    thread.start();
  }
}
