package com.cursorpoc.backend.whatsapp;

import com.cursorpoc.backend.domain.Client;

/**
 * Who a booking notice goes to (HU-WAP-04, criterio 2). A salon-made turno goes to the client's own
 * phone and her stored consent ({@link Basis#CLIENT}); an online turno carries ITS OWN verified
 * contact and the consent given in the booking form ({@link Basis#ATTESTED}), which can differ from
 * the client's file (RSV-05, criterio 9).
 */
public record BookingContact(String fullName, String phone, String email, Basis basis) {

  public enum Basis {
    /** Consent is the client's, checked against her record (and again just before the send). */
    CLIENT,
    /** The booking's own consent box was ticked; only opt-outs and unreachable numbers apply. */
    ATTESTED,
    /** No consent: the notice goes by email if there is one. */
    NONE
  }

  /** A salon-made turno: the client's own phone, email and consent. */
  public static BookingContact ofClient(Client client) {
    return new BookingContact(
        client.getFullName(), client.getPhone(), client.getEmail(), Basis.CLIENT);
  }

  /** An online turno: its own contact, with the consent given in the booking form. */
  public static BookingContact online(
      String fullName, String phone, String email, boolean whatsappOptIn) {
    return new BookingContact(fullName, phone, email, whatsappOptIn ? Basis.ATTESTED : Basis.NONE);
  }
}
