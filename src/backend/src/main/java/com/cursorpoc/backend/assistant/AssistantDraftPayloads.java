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
      BigDecimal total,
      /**
       * Lines of the ficha (or the appointment) the person dropped from the card: re-pricing
       * rebuilds that kind of draft from its source, and must not bring them back. Null means none.
       */
      List<Long> removedSourceIds) {

    public record Line(
        Long serviceId,
        String name,
        int quantity,
        BigDecimal unitPrice,
        BigDecimal lineTotal,
        Long professionalId,
        String professionalName,
        /** True when the person typed this price on the card (it survives re-pricing). */
        Boolean priceEdited,
        /**
         * The ficha line (or appointment) this line comes from. Null for a catalog item: one named
         * in the request, or added to the draft later (those survive re-pricing from the source).
         */
        Long sourceId) {

      /** The same line, remembering where it comes from. */
      public Line withSource(Long id) {
        return new Line(
            serviceId,
            name,
            quantity,
            unitPrice,
            lineTotal,
            professionalId,
            professionalName,
            priceEdited,
            id);
      }

      /** The same line with another quantity (the unit price stays: it may be the person's). */
      public Line withQuantity(int newQuantity, BigDecimal newLineTotal) {
        return new Line(
            serviceId,
            name,
            newQuantity,
            unitPrice,
            newLineTotal,
            professionalId,
            professionalName,
            priceEdited,
            sourceId);
      }

      /** The same line at another unit price, typed by the person. */
      public Line withEditedPrice(BigDecimal newUnitPrice, BigDecimal newLineTotal) {
        return new Line(
            serviceId,
            name,
            quantity,
            newUnitPrice,
            newLineTotal,
            professionalId,
            professionalName,
            Boolean.TRUE,
            sourceId);
      }
    }

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
          total,
          removedSourceIds);
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
          total,
          removedSourceIds);
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
          newTotal,
          removedSourceIds);
    }

    /** The lines left after the person dropped some, remembering which ficha lines went. */
    public InvoiceDraftPayload withoutLines(
        List<Line> newLines, BigDecimal newTotal, List<Long> removedIds) {
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
          newTotal,
          removedIds);
    }
  }

  /**
   * An appointment waiting for confirmation. {@code startAt} is the instant (ISO) the appointment
   * is created with; {@code date}, {@code time} and {@code endTime} are the same moment in the
   * salon's zone, ready to show. {@code outsideWorkingHours} only warns (the agenda does not block
   * it either).
   */
  public record AppointmentDraftPayload(
      Long clientId,
      String clientName,
      Long serviceId,
      String serviceName,
      Long professionalId,
      String professionalName,
      String startAt,
      String date,
      String time,
      String endTime,
      int durationMinutes,
      boolean outsideWorkingHours) {}
}
