package com.cursorpoc.backend.service;

import com.cursorpoc.backend.domain.Appointment;
import com.cursorpoc.backend.domain.Client;
import com.cursorpoc.backend.repository.AppointmentRepository;
import com.cursorpoc.backend.util.WhatsAppPhoneNumberFormatter;
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
 * to build the email/WhatsApp message while the session is still open — and only that — keeps the
 * read transaction itself short.
 *
 * <p><b>Issue #225 — independent channels:</b> email and WhatsApp are resolved, sent and marked
 * completely independently of each other, since a client may have email only, phone only, both, or
 * neither, and one channel's outcome must never affect the other's. {@link #resolveReminderContext}
 * reflects that: it only returns {@code null} when there is truly nothing to do for either channel
 * (appointment gone, or no client at all) — otherwise it returns a context whose {@link
 * ReminderContext#clientEmail()} and {@link ReminderContext#clientPhone()} are each independently
 * either a ready-to-use destination or {@code null} ("don't send this channel"), with the specific
 * skip reason (already sent for this slot vs. no/invalid contact info) logged here per channel.
 * {@link #markReminded} and {@link #markWhatsAppReminded} are likewise separate methods, each its
 * own short transaction, so a crash between the two calls durably keeps whichever channel already
 * committed.
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
   * Returns {@code null} (nothing to do for either channel) only when the appointment no longer
   * exists or it has no client at all. Otherwise always returns a context: {@link
   * ReminderContext#clientEmail()} and {@link ReminderContext#clientPhone()} are resolved and
   * logged independently — each is either a send-ready destination, or {@code null} because that
   * channel was already reminded for this slot or the client has no usable contact info for it. A
   * context with both {@code null} simply means the caller has nothing to send on either channel
   * this run, which is not an error.
   */
  @Transactional(readOnly = true)
  ReminderContext resolveReminderContext(long appointmentId) {
    Appointment appointment = appointmentRepository.findById(appointmentId).orElse(null);
    if (appointment == null) {
      return null;
    }

    long tenantId = appointment.getTenant().getId();

    Client client = appointment.getClient();
    if (client == null) {
      log.info(
          "Appointment reminder skipped, no client on appointment tenantId={} appointmentId={}",
          tenantId,
          appointmentId);
      return null;
    }

    String emailTarget = resolveEmailTarget(tenantId, appointmentId, appointment, client);
    String phoneTarget = resolveWhatsAppTarget(tenantId, appointmentId, appointment, client);

    return new ReminderContext(
        tenantId,
        appointment.getTenant().getName(),
        emailTarget,
        phoneTarget,
        client.getFullName(),
        appointment.getSalonService().getName(),
        appointment.getProfessional().getFullName(),
        appointment.getStartAt());
  }

  /**
   * {@code null} (skip) when already sent for this slot (belt-and-suspenders re-check of the same
   * guard {@link com.cursorpoc.backend.repository.AppointmentRepository#findDueForReminder} applies
   * — kept here too so it holds even against a row that changed between the batch query and this
   * call) or the client has no email on file.
   */
  private String resolveEmailTarget(
      long tenantId, long appointmentId, Appointment appointment, Client client) {
    if (appointment.getReminderSentAt() != null) {
      log.info(
          "Appointment email reminder skipped, already sent for current slot tenantId={}"
              + " appointmentId={}",
          tenantId,
          appointmentId);
      return null;
    }

    String email = client.getEmail();
    if (email == null || email.isBlank()) {
      log.info(
          "Appointment email reminder skipped, client has no email tenantId={} appointmentId={}",
          tenantId,
          appointmentId);
      return null;
    }

    return email.trim();
  }

  /**
   * {@code null} (skip) when already sent for this slot, or the client's on-file phone can't be
   * confidently mapped to a WhatsApp destination (missing, or not a recognizable Paraguay local/
   * E.164 shape — see {@link WhatsAppPhoneNumberFormatter}).
   */
  private String resolveWhatsAppTarget(
      long tenantId, long appointmentId, Appointment appointment, Client client) {
    if (appointment.getWhatsappReminderSentAt() != null) {
      log.info(
          "Appointment WhatsApp reminder skipped, already sent for current slot tenantId={}"
              + " appointmentId={}",
          tenantId,
          appointmentId);
      return null;
    }

    String destination = WhatsAppPhoneNumberFormatter.toWhatsAppDestination(client.getPhone());
    if (destination == null) {
      log.info(
          "Appointment WhatsApp reminder skipped, client has no usable phone number tenantId={}"
              + " appointmentId={}",
          tenantId,
          appointmentId);
      return null;
    }

    return destination;
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

  /**
   * Issue #225: WhatsApp's sibling of {@link #markReminded} — its own short transaction, marked
   * independently of the email flag so a WhatsApp send failing (or never being attempted, e.g. no
   * phone on file) never keeps the email flag from being set, and vice versa.
   */
  @Transactional
  void markWhatsAppReminded(long appointmentId, Instant sentAt) {
    appointmentRepository
        .findById(appointmentId)
        .ifPresent(a -> a.setWhatsappReminderSentAt(sentAt));
  }

  record ReminderContext(
      long tenantId,
      String tenantName,
      String clientEmail,
      String clientPhone,
      String clientName,
      String serviceName,
      String professionalName,
      Instant startAt) {}
}
