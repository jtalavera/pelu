package com.cursorpoc.backend.whatsapp;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** HU-WAP-06 criterio 3: only a payload we signed is believed. */
class WhatsAppPayloadsTest {

  private static WhatsAppPayloads payloads(String secret) {
    return new WhatsAppPayloads(
        secret, new WhatsAppSettings(false, "fake", "", "", "", "", "", "v21.0", "", 1, 1, 1));
  }

  @Test
  void aSignedPayloadRoundTrips() {
    WhatsAppPayloads p = payloads("secret-one");
    String signed = p.sign(WhatsAppPayloads.Action.CANT_GO, 42);

    assertThat(p.verify(signed))
        .contains(new WhatsAppPayloads.Parsed(WhatsAppPayloads.Action.CANT_GO, 42));
    assertThat(signed.length()).isLessThan(100); // Meta's payload limit is 256
  }

  @Test
  void tamperedPayloadsAreRejected() {
    WhatsAppPayloads p = payloads("secret-one");
    String signed = p.sign(WhatsAppPayloads.Action.CONFIRM, 42);

    assertThat(p.verify(signed.replace(".42.", ".43."))).isEmpty(); // another turno
    assertThat(p.verify(signed.replace("CONFIRM", "CANCEL_YES"))).isEmpty(); // another action
    assertThat(p.verify(signed.substring(0, signed.length() - 2) + "00")).isEmpty();
    assertThat(p.verify("v2." + signed.substring(3))).isEmpty();
  }

  @Test
  void aPayloadSignedWithAnotherKeyIsRejected() {
    String foreign = payloads("secret-two").sign(WhatsAppPayloads.Action.CONFIRM, 42);
    assertThat(payloads("secret-one").verify(foreign)).isEmpty();
  }

  @Test
  void garbageIsRejected() {
    WhatsAppPayloads p = payloads("secret-one");
    assertThat(p.verify(null)).isEmpty();
    assertThat(p.verify("")).isEmpty();
    assertThat(p.verify("hola")).isEmpty();
    assertThat(p.verify("v1.CONFIRM.x.abc")).isEmpty();
    assertThat(p.verify("v1.NOPE.42.abc")).isEmpty();
    assertThat(p.verify("x".repeat(500))).isEmpty();
  }

  @Test
  void withoutAnySecretButtonsCannotBeSigned() {
    assertThat(payloads("").isAvailable()).isFalse();
    assertThat(payloads("secret-one").isAvailable()).isTrue();
  }

  @Test
  void commandWordsIgnoreCaseAccentsAndPunctuation() {
    assertThat(WhatsAppInboundService.normalizeWord(" ¡BAJA! ")).isEqualTo("baja");
    assertThat(WhatsAppInboundService.normalizeWord("No   quiero.")).isEqualTo("no quiero");
    assertThat(WhatsAppInboundService.normalizeWord("Stop")).isEqualTo("stop");
    assertThat(WhatsAppInboundService.normalizeWord("alta")).isEqualTo("alta");
    assertThat(WhatsAppInboundService.normalizeWord("quiero la baja de mi turno"))
        .isEqualTo("quiero la baja de mi turno");
    assertThat(WhatsAppInboundService.normalizeWord(null)).isEmpty();
  }
}
