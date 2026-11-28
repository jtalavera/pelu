package com.cursorpoc.backend.service;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Issue #218: hourly trigger of {@link AppointmentReminderService}. Gated by the same {@code
 * app.femme.email.enabled} flag that governs every other outbound email ({@code
 * application-e2e.properties} sets it to {@code false}): when it is off this bean is not
 * registered, so the job never polls the database under {@code e2e}. The logic itself lives in the
 * service so tests can run it with a simulated clock.
 */
@Component
@ConditionalOnProperty(
    name = "app.femme.email.enabled",
    havingValue = "true",
    matchIfMissing = true)
public class AppointmentReminderScheduler {

  static final long REMINDER_INTERVAL_MILLIS = 60L * 60 * 1000; // hourly

  private final AppointmentReminderService reminders;

  public AppointmentReminderScheduler(AppointmentReminderService reminders) {
    this.reminders = reminders;
  }

  @Scheduled(fixedDelay = REMINDER_INTERVAL_MILLIS)
  public void sendDueReminders() {
    reminders.sendDueReminders();
  }
}
