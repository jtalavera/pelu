package com.cursorpoc.backend.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.service.AppointmentService;
import com.cursorpoc.backend.web.dto.AppointmentCreateRequest;
import com.cursorpoc.backend.web.dto.AppointmentResponse;
import com.cursorpoc.backend.web.dto.AppointmentStatusUpdateRequest;
import com.cursorpoc.backend.web.dto.AppointmentUpdateRequest;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.web.server.ResponseStatusException;

/**
 * HU-24 (issue #38 follow-up): a professional sees every professional's appointments and may filter
 * by professional, but only creates / edits / changes the status of her own.
 */
@ExtendWith(MockitoExtension.class)
class AppointmentControllerOwnershipTest {

  private static final long TENANT = 7L;
  private static final long OWN = 9L;
  private static final long OTHER = 10L;
  private static final String FROM = "2026-10-19T00:00:00Z";
  private static final String TO = "2026-10-26T00:00:00Z";

  private static final FemmeUserPrincipal PROFESSIONAL =
      new FemmeUserPrincipal(3L, TENANT, "pro@salon.test", UserRole.PROFESSIONAL, OWN);
  private static final FemmeUserPrincipal ADMIN =
      new FemmeUserPrincipal(2L, TENANT, "admin@salon.test", UserRole.ADMIN, null);

  @Mock private AppointmentService service;

  private AppointmentController controller() {
    return new AppointmentController(service);
  }

  private static AppointmentResponse appointmentOf(long id, long professionalId) {
    return new AppointmentResponse(
        id, null, null, professionalId, "P", 1L, "S", 30, FROM, TO, "PENDING", null, null, false);
  }

  private static void assertNotOwned(Runnable call) {
    assertThatThrownBy(call::run)
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining(AppointmentController.NOT_OWN_APPOINTMENT);
  }

  @Test
  void professional_listsEveryAppointment_orFiltersByAnyProfessional() {
    controller().list(PROFESSIONAL, FROM, TO, null, null);
    verify(service).list(eq(TENANT), any(Instant.class), any(Instant.class), isNull(), isNull());

    controller().list(PROFESSIONAL, FROM, TO, OTHER, null);
    verify(service).list(eq(TENANT), any(Instant.class), any(Instant.class), eq(OTHER), isNull());
  }

  @Test
  void professional_readsAnotherProfessionalsAppointment() {
    when(service.get(TENANT, 1L)).thenReturn(appointmentOf(1L, OTHER));
    assertThat(controller().get(PROFESSIONAL, 1L).professionalId()).isEqualTo(OTHER);
  }

  @Test
  void professional_cannotCreateForAnotherProfessional() {
    assertNotOwned(
        () ->
            controller().create(PROFESSIONAL, new AppointmentCreateRequest(null, OTHER, 1L, FROM)));
    verify(service, never()).create(anyLong(), any());
  }

  @Test
  void professional_cannotEditAnotherProfessionalsAppointment_evenTakingItOver() {
    when(service.get(TENANT, 1L)).thenReturn(appointmentOf(1L, OTHER));
    assertNotOwned(
        () ->
            controller()
                .update(PROFESSIONAL, 1L, new AppointmentUpdateRequest(null, OWN, 1L, FROM)));
    verify(service, never()).update(anyLong(), anyLong(), any());
  }

  @Test
  void professional_cannotHandHerAppointmentToAnotherProfessional() {
    when(service.get(TENANT, 1L)).thenReturn(appointmentOf(1L, OWN));
    assertNotOwned(
        () ->
            controller()
                .update(PROFESSIONAL, 1L, new AppointmentUpdateRequest(null, OTHER, 1L, FROM)));
  }

  @Test
  void professional_cannotChangeTheStatusOfAnotherProfessionalsAppointment() {
    when(service.get(TENANT, 1L)).thenReturn(appointmentOf(1L, OTHER));
    assertNotOwned(
        () ->
            controller()
                .updateStatus(
                    PROFESSIONAL, 1L, new AppointmentStatusUpdateRequest("CANCELLED", null)));
    verify(service, never()).updateStatus(anyLong(), anyLong(), any());
  }

  @Test
  void professional_editsHerOwnAppointment() {
    when(service.get(TENANT, 1L)).thenReturn(appointmentOf(1L, OWN));
    var request = new AppointmentUpdateRequest(null, OWN, 1L, FROM);
    controller().update(PROFESSIONAL, 1L, request);
    verify(service).update(TENANT, 1L, request);

    var status = new AppointmentStatusUpdateRequest("CONFIRMED", null);
    controller().updateStatus(PROFESSIONAL, 1L, status);
    verify(service).updateStatus(TENANT, 1L, status);
  }

  @Test
  void admin_editsAnyAppointment_withoutOwnershipLookup() {
    var request = new AppointmentUpdateRequest(null, OTHER, 1L, FROM);
    controller().update(ADMIN, 1L, request);
    verify(service).update(TENANT, 1L, request);
    verify(service, never()).get(anyLong(), anyLong());
  }
}
