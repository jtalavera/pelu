package com.cursorpoc.backend.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.domain.Appointment;
import com.cursorpoc.backend.domain.WhatsAppMessage;
import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.repository.AppointmentRepository;
import com.cursorpoc.backend.repository.WhatsAppMessageRepository;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.web.dto.AppointmentMessagesResponse;
import com.cursorpoc.backend.whatsapp.WhatsAppAccess;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/**
 * HU-WAP-07 criterios 7 y 10: the administrator sees the last notice's state and the number; the
 * professional only learns that a notice went out (never a phone); a foreign appointment is a 404;
 * with the channel's flags off the route answers 403 (RT-01).
 */
class AppointmentMessagesControllerTest {

  private static final FemmeUserPrincipal ADMIN =
      new FemmeUserPrincipal(2L, 7L, "admin@salon.test", UserRole.ADMIN, null);
  private static final FemmeUserPrincipal PROFESSIONAL =
      new FemmeUserPrincipal(3L, 7L, "pro@salon.test", UserRole.PROFESSIONAL, 9L);

  private AppointmentRepository appointments;
  private WhatsAppMessageRepository messages;
  private WhatsAppAccess access;
  private AppointmentMessagesController controller;

  @BeforeEach
  void setUp() {
    appointments = mock(AppointmentRepository.class);
    messages = mock(WhatsAppMessageRepository.class);
    access = mock(WhatsAppAccess.class);
    controller = new AppointmentMessagesController(appointments, messages, access);
    when(appointments.findByIdAndTenant_Id(12L, 7L)).thenReturn(Optional.of(new Appointment()));
  }

  private static WhatsAppMessage message(String status) {
    WhatsAppMessage m = new WhatsAppMessage();
    m.setTemplate("pelu_recordatorio_turno");
    m.setPurpose("REMINDER");
    m.setStatus(status);
    m.setRecipient("+595981123456");
    m.setQueuedAt(Instant.parse("2026-11-26T12:00:00Z"));
    m.setDeliveredAt(Instant.parse("2026-11-26T12:00:05Z"));
    m.setFallbackEmail("ana@example.com");
    return m;
  }

  private void rows(WhatsAppMessage... rows) {
    when(messages.findByTenantIdAndAppointmentIdAndPurposeInOrderByIdDesc(
            anyLong(), anyLong(), anyCollection()))
        .thenReturn(List.of(rows));
  }

  @Test
  void administrator_seesTheLastNoticeWithItsStateAndNumber() {
    rows(message(WhatsAppMessage.DELIVERED));

    AppointmentMessagesResponse out = controller.messages(ADMIN, 12L);

    assertThat(out.hasNotice()).isTrue();
    assertThat(out.last().status()).isEqualTo("DELIVERED");
    assertThat(out.last().recipient()).isEqualTo("+595981123456");
    assertThat(out.last().template()).isEqualTo("pelu_recordatorio_turno");
    assertThat(out.last().deliveredAt()).isEqualTo("2026-11-26T12:00:05Z");
    assertThat(out.last().fallbackEmailAvailable()).isTrue();
    assertThat(out.last().fallbackEmailSent()).isFalse();
  }

  @Test
  void professional_onlyLearnsThatANoticeWentOut_neverTheNumberOrTheDetails() {
    rows(message(WhatsAppMessage.READ));

    AppointmentMessagesResponse out = controller.messages(PROFESSIONAL, 12L);

    assertThat(out.hasNotice()).isTrue();
    assertThat(out.last()).isNull();
    assertThat(out.toString()).doesNotContain("595981123456").doesNotContain("ana@example.com");
  }

  @Test
  void noNoticeYet_isReportedAsSuch_forBothRoles() {
    rows();

    assertThat(controller.messages(ADMIN, 12L))
        .isEqualTo(new AppointmentMessagesResponse(false, null));
    assertThat(controller.messages(PROFESSIONAL, 12L))
        .isEqualTo(new AppointmentMessagesResponse(false, null));
  }

  @Test
  void anAppointmentOfAnotherSalon_isNotFound() {
    assertThatThrownBy(() -> controller.messages(ADMIN, 99L))
        .isInstanceOfSatisfying(
            ResponseStatusException.class,
            e -> assertThat(e.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND));
  }

  @Test
  void withTheChannelsFlagsOff_theRouteIsForbidden() {
    doThrow(new ResponseStatusException(HttpStatus.FORBIDDEN, "WHATSAPP_REMINDERS_DISABLED"))
        .when(access)
        .requireFlags(7L);

    assertThatThrownBy(() -> controller.messages(ADMIN, 12L))
        .isInstanceOfSatisfying(
            ResponseStatusException.class,
            e -> {
              assertThat(e.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
              assertThat(e.getReason()).isEqualTo("WHATSAPP_REMINDERS_DISABLED");
            });
  }

  @Test
  void unauthenticated_isRejected() {
    assertThatThrownBy(() -> controller.messages(null, 12L))
        .isInstanceOfSatisfying(
            ResponseStatusException.class,
            e -> assertThat(e.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED));
  }

  @Test
  void onlyBookingNoticesAndReminders_countAsNotices() {
    rows(message(WhatsAppMessage.SENT));
    controller.messages(ADMIN, 12L);

    org.mockito.Mockito.verify(messages)
        .findByTenantIdAndAppointmentIdAndPurposeInOrderByIdDesc(
            7L, 12L, List.of("BOOKING", "REMINDER"));
  }
}
