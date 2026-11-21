package com.cursorpoc.backend.assistant;

import java.math.BigDecimal;
import java.util.List;

/**
 * The validated JSON stored in {@code assistant_draft.payload}. The card is drawn from THIS, never
 * from text the model wrote: prices, totals and names are the backend's.
 */
public final class AssistantDraftPayloads {

  private AssistantDraftPayloads() {}

  /**
   * An invoice waiting for confirmation. {@code serviceRecordId} / {@code appointmentId} say what
   * it charges (an open service record, or one appointment); with neither, it is catalog services.
   * {@code paymentMethod}, {@code cardBrand} and {@code email} start null and are completed from
   * the card ({@code PATCH}); {@code receiverIdentified} tells whether SIFEN would need an e-mail.
   */
  public record InvoiceDraftPayload(
      Long clientId,
      String clientName,
      boolean receiverIdentified,
      List<Line> lines,
      Long serviceRecordId,
      Long appointmentId,
      String paymentMethod,
      String cardBrand,
      String email,
      BigDecimal total) {

    public record Line(
        Long serviceId,
        String name,
        int quantity,
        BigDecimal unitPrice,
        BigDecimal lineTotal,
        Long professionalId,
        String professionalName) {}

    public InvoiceDraftPayload withPayment(String method, String brand) {
      return new InvoiceDraftPayload(
          clientId,
          clientName,
          receiverIdentified,
          lines,
          serviceRecordId,
          appointmentId,
          method,
          brand,
          email,
          total);
    }

    public InvoiceDraftPayload withEmail(String newEmail) {
      return new InvoiceDraftPayload(
          clientId,
          clientName,
          receiverIdentified,
          lines,
          serviceRecordId,
          appointmentId,
          paymentMethod,
          cardBrand,
          newEmail,
          total);
    }

    public InvoiceDraftPayload withLines(List<Line> newLines, BigDecimal newTotal) {
      return new InvoiceDraftPayload(
          clientId,
          clientName,
          receiverIdentified,
          newLines,
          serviceRecordId,
          appointmentId,
          paymentMethod,
          cardBrand,
          email,
          newTotal);
    }
  }
}
