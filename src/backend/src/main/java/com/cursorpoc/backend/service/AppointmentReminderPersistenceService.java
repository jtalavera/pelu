package com.cursorpoc.backend.service;

import com.cursorpoc.backend.domain.Appointment;
import com.cursorpoc.backend.domain.Client;
import com.cursorpoc.backend.repository.AppointmentRepository;
import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Issue #218 code review follow-up: the short, separately-transactional DB reads/writes {@link
 * AppointmentReminderScheduler} needs around the (non-transactional, potentially slow) outbound
 * email send — same reasoning, and the same "separate bean, not a self-invoked method on the
 * caller" shape, as {@link SifenInvoiceSubmissionPersistenceService}. A same-class call bypasses
 * Spring's {@code @Transactional} proxy entirely, so splitting the per-appointment read and the
 * per-appointment write into their own bean (rather than two {@code @Transactional} methods on
 * {@code AppointmentReminderScheduler} itself) is what actually gives each appointment its own
 * independent, durable commit.
 *
 * <p>{@link #resolveReminderContext} deliberately returns a plain {@link ReminderContext} record,
 * never the {@code Appointment} entity itself: {@code Appointment.tenant}/{@code client}/{@code
 * professional}/{@code salonService} are all {@code FetchType.LAZY}, and a detached entity handed
 * back across this method's transactional boundary would throw {@code LazyInitializationException}
 * the moment the caller touched any of them outside this transaction. Resolving every value needed
 * to build the email while the session is still open — and only that — keeps the read transaction
 * itself short.
 */
@Service
class AppointmentReminderPersistenceService {

  private static final Logger log =
      LoggerFactory.getLogger(AppointmentReminderPersistenceService.class);

  private final AppointmentRepository appointmentRepository;

  AppointmentReminderPersistenceService(AppointmentRepository appointmentRepository) {
    this.appointmentRepository = appointmentRepository;
  }

  /**
   * Returns {@code null} (nothing to send) when the appointment no longer exists, was already
   * reminded for its current slot (belt-and-suspenders re-check of the same guard {@code
   * AppointmentRepository#findDueForReminder} applies — kept here too so it holds even against a
   * row that changed between the batch query and this call), or its client has no email on file —
   * each case logged at INFO here, since this is the one place with an authoritative, freshly-read
   * view of the row.
   */
  @Transactional(readOnly = true)
  ReminderContext resolveReminderContext(long appointmentId) {
    Appointment appointment = appointmentRepository.findById(appointmentId).orElse(null);
    if (appointment == null) {
      return null;
    }

    long tenantId = appointment.getTenant().getId();

    if (appointment.getReminderSentAt() != null) {
      log.info(
          "Appointment reminder skipped, already sent for current slot tenantId={} appointmentId={}",
          tenantId,
          appointmentId);
      return null;
    }

    Client client = appointment.getClient();
    String email = client == null ? null : client.getEmail();
    if (email == null || email.isBlank()) {
      log.info(
          "Appointment reminder skipped, client has no email tenantId={} appointmentId={}",
          tenantId,
          appointmentId);
      return null;
    }

    return new ReminderContext(
        tenantId,
        appointment.getTenant().getName(),
        email.trim(),
        client.getFullName(),
        appointment.getSalonService().getName(),
        appointment.getProfessional().getFullName(),
        appointment.getStartAt());
  }

  /**
   * Its own short transaction, committed independently of every other appointment processed in the
   * same run — a crash right after this call leaves every appointment reminded earlier in the run
   * durably marked, and only the one currently in flight (if any) unmarked.
   */
  @Transactional
  void markReminded(long appointmentId, Instant sentAt) {
    appointmentRepository.findById(appointmentId).ifPresent(a -> a.setReminderSentAt(sentAt));
  }

  record ReminderContext(
      long tenantId,
      String tenantName,
      String clientEmail,
      String clientName,
      String serviceName,
      String professionalName,
      Instant startAt) {}
}
