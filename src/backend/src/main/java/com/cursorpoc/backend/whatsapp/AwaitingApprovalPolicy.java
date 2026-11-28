package com.cursorpoc.backend.whatsapp;

import com.cursorpoc.backend.domain.Appointment;

/**
 * HU-WAP-05 (criterio 4): an ONLINE booking still waiting for the salon's approval is not yet a
 * turno of the salon and gets no reminder; a PENDING turno created by the salon does. Telling them
 * apart needs the turno's origin ({@code appointments.source}, A4), which does not exist yet, so
 * the default says no turno is waiting for approval (today's behaviour). A4 replaces it.
 */
public interface AwaitingApprovalPolicy {

  boolean isAwaitingApproval(Appointment appointment);
}
