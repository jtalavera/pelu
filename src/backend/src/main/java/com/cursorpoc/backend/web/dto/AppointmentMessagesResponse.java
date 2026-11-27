package com.cursorpoc.backend.web.dto;

/**
 * HU-WAP-07 criterio 7: the state of the notices of an appointment. The administrator sees the last
 * notice's status and times; the professional only learns whether a notice went out ({@code last}
 * is null for her, never a phone).
 */
public record AppointmentMessagesResponse(boolean hasNotice, Notice last) {

  /** QUEUED, SENT, DELIVERED, READ, FAILED or CANCELLED; ISO instants. */
  public record Notice(
      String template,
      String purpose,
      String status,
      String errorCode,
      String queuedAt,
      String sentAt,
      String deliveredAt,
      String readAt,
      String failedAt,
      boolean fallbackEmailSent,
      boolean fallbackEmailAvailable,
      /** The number the notice went to (administrator only; masked after the retention period). */
      String recipient) {}
}
