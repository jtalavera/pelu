package com.cursorpoc.backend.whatsapp;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class WhatsAppTemplateVariablesTest {

  @Test
  void sanitize_removesLineBreaksTabsAndRepeatedSpaces() {
    assertThat(WhatsAppTemplateVariables.sanitize(" a\nb\t\tc    d\r\ne ")).isEqualTo("a b c d e");
  }

  @Test
  void sanitize_capsTheLength_andNullIsEmpty() {
    assertThat(WhatsAppTemplateVariables.sanitize("x".repeat(200)))
        .hasSize(WhatsAppTemplateVariables.MAX_LENGTH);
    assertThat(WhatsAppTemplateVariables.sanitize(null)).isEmpty();
    assertThat(WhatsAppTemplateVariables.sanitize("   ")).isEmpty();
  }

  @Test
  void firstName_isTheFirstWordWithAnInitialCapital() {
    assertThat(WhatsAppTemplateVariables.firstName("MARÍA JOSÉ lópez")).isEqualTo("María");
    assertThat(WhatsAppTemplateVariables.firstName("  ana   perez ")).isEqualTo("Ana");
    assertThat(WhatsAppTemplateVariables.firstName("Ñandú\nGómez")).isEqualTo("Ñandú");
  }

  @Test
  void firstName_blankFallsBackToAGenericGreeting() {
    assertThat(WhatsAppTemplateVariables.firstName(null))
        .isEqualTo(WhatsAppTemplateVariables.FALLBACK_GREETING_NAME);
    assertThat(WhatsAppTemplateVariables.firstName("  \n "))
        .isEqualTo(WhatsAppTemplateVariables.FALLBACK_GREETING_NAME);
  }
}
