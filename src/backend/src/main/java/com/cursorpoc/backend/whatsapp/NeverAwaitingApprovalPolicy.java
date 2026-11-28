package com.cursorpoc.backend.whatsapp;

import com.cursorpoc.backend.domain.Appointment;
import org.springframework.stereotype.Component;

/** Until online bookings exist (A4) every turno is a turno of the salon. */
@Component
public class NeverAwaitingApprovalPolicy implements AwaitingApprovalPolicy {

  @Override
  public boolean isAwaitingApproval(Appointment appointment) {
    return false;
  }
}
