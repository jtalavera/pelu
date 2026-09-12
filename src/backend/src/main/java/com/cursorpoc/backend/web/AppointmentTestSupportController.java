package com.cursorpoc.backend.web;

import com.cursorpoc.backend.domain.Appointment;
import com.cursorpoc.backend.domain.enums.AppointmentStatus;
import com.cursorpoc.backend.repository.AppointmentRepository;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Test-only support endpoint, gated behind the same {@code femme.data-init.enabled} flag as {@link
 * SeedResetController} / {@link SifenInvoiceTestSupportController} (true only for the {@code e2e}
 * Spring profile — see application-e2e.properties). Never reachable in production.
 *
 * <p>Issue #216 ("Panel de clientes inactivos"): {@code AppointmentService.create}/{@code .update}
 * reject a {@code startAt} in the past ({@code APPOINTMENT_START_IN_PAST}), so Playwright cannot
 * seed a client's "last completed visit" 60+ days ago through the real API alone. This lets a spec
 * create a normal (future) appointment via {@code POST /api/appointments} and then backdate +
 * complete it directly, without waiting on a real clock or duplicating the validation the real
 * endpoints already cover elsewhere.
 */
@RestController
@RequestMapping("/api/admin/appointment-test-support")
@ConditionalOnProperty(name = "femme.data-init.enabled", havingValue = "true")
public class AppointmentTestSupportController {

  private static final Logger log = LoggerFactory.getLogger(AppointmentTestSupportController.class);

  private final AppointmentRepository appointmentRepository;

  public AppointmentTestSupportController(AppointmentRepository appointmentRepository) {
    this.appointmentRepository = appointmentRepository;
  }

  @PostMapping("/{id}/backdate-and-complete/{daysAgo}")
  @Transactional
  public void backdateAndComplete(@PathVariable long id, @PathVariable long daysAgo) {
    log.info("POST /api/admin/appointment-test-support/{}/backdate-and-complete/{}", id, daysAgo);
    Appointment appointment =
        appointmentRepository
            .findById(id)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "APPOINTMENT_NOT_FOUND"));

    Duration duration = Duration.between(appointment.getStartAt(), appointment.getEndAt());
    Instant newStart = Instant.now().minus(daysAgo, ChronoUnit.DAYS);

    appointment.setStartAt(newStart);
    appointment.setEndAt(newStart.plus(duration));
    appointment.setStatus(AppointmentStatus.COMPLETED);
    appointmentRepository.save(appointment);
  }
}
