package com.cursorpoc.backend.whatsapp;

import com.cursorpoc.backend.domain.Appointment;
import java.time.Duration;
import java.time.Instant;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Until salons can configure their own deadline (RSV-02), a platform-wide one: a client may cancel
 * while the turno is at least {@code app.femme.whatsapp.cancellation-deadline-hours} away (default
 * 0: any turno that has not started).
 */
@Component
public class DeadlineCancellationPolicy implements CancellationPolicy {

  private final Duration deadline;

  public DeadlineCancellationPolicy(
      @Value("${app.femme.whatsapp.cancellation-deadline-hours:0}") int deadlineHours) {
    this.deadline = Duration.ofHours(deadlineHours);
  }

  @Override
  public boolean allowsClientCancellation(Appointment appointment, Instant now) {
    return appointment.getStartAt().isAfter(now.plus(deadline).minusNanos(1));
  }
}
