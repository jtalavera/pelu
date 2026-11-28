package com.cursorpoc.backend.whatsapp;

/**
 * The fixed texts the system answers a client with (HU-WAP-06). They are free-form replies inside
 * the 24 h window the client's own message opened, so they need no approved template.
 */
final class WhatsAppReplyTexts {

  private WhatsAppReplyTexts() {}

  static String confirmed(String name, String date, String time, String salon) {
    return "¡Gracias, "
        + name
        + "! Tu turno del "
        + date
        + " a las "
        + time
        + " en "
        + salon
        + " quedó confirmado.";
  }

  static String notCurrent() {
    return "Ese turno ya no está vigente. Si necesitás ayuda, comunicate con el salón.";
  }

  static String askCancel(String date, String time, String salon) {
    return "¿Querés cancelar tu turno del " + date + " a las " + time + " en " + salon + "?";
  }

  static String cancelled(String date, String time) {
    return "Listo, cancelamos tu turno del "
        + date
        + " a las "
        + time
        + ". Podés pedir uno nuevo cuando quieras.";
  }

  static String tooLateToCancel(String salon, String phone) {
    String contact = phone == null || phone.isBlank() ? salon : salon + " al " + phone;
    return "Ya no se puede cancelar desde acá. Comunicate directamente con " + contact + ".";
  }

  static String kept(String date, String time) {
    return "Perfecto, mantenemos tu turno del " + date + " a las " + time + ". ¡Te esperamos!";
  }

  static String optedOut() {
    return "Listo, no vas a recibir más avisos de turnos por WhatsApp. "
        + "Si querés volver a recibirlos, respondé ALTA.";
  }

  static String optedIn() {
    return "Listo, volverás a recibir los avisos de turnos por WhatsApp de los salones donde diste tu consentimiento.";
  }

  static String noticesOnly(String salon, String phone) {
    String base = "Este número solo envía avisos de turnos y no recibe consultas.";
    if (salon == null) {
      return base;
    }
    String contact = phone == null || phone.isBlank() ? salon : salon + " al " + phone;
    return base + " Para consultas, comunicate con " + contact + ".";
  }
}
