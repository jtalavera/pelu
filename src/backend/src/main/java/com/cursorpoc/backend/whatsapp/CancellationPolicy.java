package com.cursorpoc.backend.whatsapp;

import com.cursorpoc.backend.domain.Appointment;
import java.time.Instant;

/**
 * Whether a client may still cancel a turno by herself (RSV-02: the salon's cancellation deadline,
 * which does not exist yet). HU-WAP-06 criterio 5: inside the deadline the turno is cancelled;
 * outside it she is given the salon's phone and nothing is cancelled. A2/A3 replace the default.
 */
public interface CancellationPolicy {

  boolean allowsClientCancellation(Appointment appointment, Instant now);
}
