package com.cursorpoc.backend.web;

import com.cursorpoc.backend.domain.WhatsAppMessage;
import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.repository.AppointmentRepository;
import com.cursorpoc.backend.repository.WhatsAppMessageRepository;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.web.dto.AppointmentMessagesResponse;
import com.cursorpoc.backend.web.dto.AppointmentMessagesResponse.Notice;
import com.cursorpoc.backend.whatsapp.WhatsAppAccess;
import java.time.Instant;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * HU-WAP-07 (criterios 7 y 10): the status of the last notice of an appointment ("Entregado",
 * "Leído", "No entregado"). Scoped to the caller's salon (a foreign appointment is a 404). The
 * professional only learns whether a notice exists.
 */
@RestController
public class AppointmentMessagesController {

  private static final Logger log = LoggerFactory.getLogger(AppointmentMessagesController.class);
  private static final List<String> PURPOSES = List.of("BOOKING", "REMINDER");

  private final AppointmentRepository appointments;
  private final WhatsAppMessageRepository messages;
  private final WhatsAppAccess access;

  public AppointmentMessagesController(
      AppointmentRepository appointments,
      WhatsAppMessageRepository messages,
      WhatsAppAccess access) {
    this.appointments = appointments;
    this.messages = messages;
    this.access = access;
  }

  @GetMapping("/api/appointments/{id}/messages")
  @Transactional(readOnly = true)
  public AppointmentMessagesResponse messages(
      @AuthenticationPrincipal FemmeUserPrincipal principal, @PathVariable("id") long id) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    long tenantId = principal.getTenantId();
    log.info("GET /api/appointments/{}/messages tenantId={}", id, tenantId);
    try {
      access.requireFlags(tenantId);
      appointments
          .findByIdAndTenant_Id(id, tenantId)
          .orElseThrow(
              () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "APPOINTMENT_NOT_FOUND"));
      List<WhatsAppMessage> rows =
          messages.findByTenantIdAndAppointmentIdAndPurposeInOrderByIdDesc(tenantId, id, PURPOSES);
      AppointmentMessagesResponse out;
      if (rows.isEmpty()) {
        out = new AppointmentMessagesResponse(false, null);
      } else if (principal.getRole() == UserRole.PROFESSIONAL) {
        out = new AppointmentMessagesResponse(true, null);
      } else {
        out = new AppointmentMessagesResponse(true, notice(rows.get(0)));
      }
      log.info("GET /api/appointments/{}/messages tenantId={} status=200", id, tenantId);
      return out;
    } catch (ResponseStatusException ex) {
      log.error(
          "GET /api/appointments/{}/messages tenantId={} status={}",
          id,
          tenantId,
          ex.getStatusCode());
      throw ex;
    }
  }

  private static Notice notice(WhatsAppMessage m) {
    return new Notice(
        m.getTemplate(),
        m.getPurpose(),
        m.getStatus(),
        m.getErrorCode(),
        iso(m.getQueuedAt()),
        iso(m.getSentAt()),
        iso(m.getDeliveredAt()),
        iso(m.getReadAt()),
        iso(m.getFailedAt()),
        m.getFallbackEmailSentAt() != null,
        m.getFallbackEmail() != null,
        m.getRecipient());
  }

  private static String iso(Instant i) {
    return i == null ? null : i.toString();
  }
}
