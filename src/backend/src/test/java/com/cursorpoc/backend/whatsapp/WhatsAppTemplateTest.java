package com.cursorpoc.backend.whatsapp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;

class WhatsAppTemplateTest {

  private static final String TO = "+595981123456";

  @Test
  void catalog_hasTheSevenTemplatesOfTheMetaSubmission() {
    assertThat(Arrays.stream(WhatsAppTemplate.values()).map(WhatsAppTemplate::templateName))
        .containsExactlyInAnyOrder(
            "pelu_codigo_verificacion",
            "pelu_turno_confirmado",
            "pelu_turno_pendiente",
            "pelu_turno_no_disponible",
            "pelu_propuesta_horario",
            "pelu_recordatorio_turno",
            "pelu_turno_cancelado");
  }

  @Test
  void catalog_categoriesVariablesAndButtons() {
    assertThat(WhatsAppTemplate.CODIGO_VERIFICACION.category())
        .isEqualTo(WhatsAppTemplate.Category.AUTHENTICATION);
    for (WhatsAppTemplate t : WhatsAppTemplate.values()) {
      if (t != WhatsAppTemplate.CODIGO_VERIFICACION) {
        assertThat(t.category()).isEqualTo(WhatsAppTemplate.Category.UTILITY);
        assertThat(t.footer()).isEqualTo("Respondé BAJA para dejar de recibir avisos");
      }
    }
    assertThat(WhatsAppTemplate.TURNO_CONFIRMADO.bodyVariables()).isEqualTo(6);
    assertThat(WhatsAppTemplate.TURNO_PENDIENTE.bodyVariables()).isEqualTo(5);
    assertThat(WhatsAppTemplate.TURNO_NO_DISPONIBLE.bodyVariables()).isEqualTo(4);
    assertThat(WhatsAppTemplate.PROPUESTA_HORARIO.bodyVariables()).isEqualTo(4);
    assertThat(WhatsAppTemplate.RECORDATORIO_TURNO.bodyVariables()).isEqualTo(5);
    assertThat(WhatsAppTemplate.TURNO_CANCELADO.bodyVariables()).isEqualTo(4);
    assertThat(WhatsAppTemplate.RECORDATORIO_TURNO.buttons())
        .extracting(WhatsAppTemplate.ButtonSpec::text)
        .containsExactly("Confirmo", "No puedo ir", "Ver mi turno");
  }

  @Test
  void catalog_bodyTextUsesExactlyThePlaceholdersOfItsVariableCount() {
    for (WhatsAppTemplate t : WhatsAppTemplate.values()) {
      if (t.bodyText() == null) {
        continue;
      }
      Matcher m = Pattern.compile("\\{\\{(\\d+)}}").matcher(t.bodyText());
      int max = 0;
      int count = 0;
      while (m.find()) {
        count++;
        max = Math.max(max, Integer.parseInt(m.group(1)));
      }
      assertThat(max).as(t.templateName()).isEqualTo(t.bodyVariables());
      assertThat(count).as(t.templateName()).isEqualTo(t.bodyVariables());
      // Meta rejects a body that starts or ends with a variable.
      assertThat(t.bodyText()).doesNotStartWith("{{").doesNotEndWith("}}");
      // Strictly transactional: no promotions (criterio 5).
      assertThat(t.bodyText().toLowerCase())
          .doesNotContain("descuento", "promo", "oferta", "gratis");
    }
  }

  /** The submission document and the code must agree on every body text. */
  @Test
  void catalog_matchesTheMetaSubmissionDocument() throws Exception {
    Path doc = Path.of("../../requirements/user_stories/Plantillas_WhatsApp_para_Meta.md");
    if (!Files.exists(doc)) {
      return; // the module can be built outside the monorepo
    }
    String text = Files.readString(doc);
    for (WhatsAppTemplate t : WhatsAppTemplate.values()) {
      assertThat(text)
          .as("document mentions " + t.templateName())
          .contains("`" + t.templateName() + "`");
      if (t.bodyText() != null) {
        assertThat(text).as("body of " + t.templateName()).contains(t.bodyText());
      }
    }
  }

  @Test
  void message_sanitizesEveryVariable() {
    WhatsAppOutboundMessage m =
        WhatsAppTemplate.TURNO_CANCELADO.message(
            TO,
            List.of("  Ana\n", "Salón\tBella   Centro", "Corte\r\ny brushing", "viernes 28/11"),
            List.of(WhatsAppButton.url(0, "bella")));

    assertThat(m.bodyParameters())
        .containsExactly("Ana", "Salón Bella Centro", "Corte y brushing", "viernes 28/11");
    assertThat(m.languageCode()).isEqualTo("es");
    assertThat(m.templateName()).isEqualTo("pelu_turno_cancelado");
  }

  @Test
  void message_wrongVariableCount_isRejected() {
    assertThatThrownBy(
            () ->
                WhatsAppTemplate.TURNO_CANCELADO.message(
                    TO, List.of("a", "b"), List.of(WhatsAppButton.url(0, "bella"))))
        .isInstanceOfSatisfying(
            WhatsAppSendException.class,
            e -> assertThat(e.getCode()).isEqualTo(WhatsAppErrorCode.INVALID_REQUEST));
  }

  @Test
  void message_emptyVariable_isRejected() {
    assertThatThrownBy(
            () ->
                WhatsAppTemplate.TURNO_CANCELADO.message(
                    TO,
                    List.of("Ana", " ", "Corte", "viernes"),
                    List.of(WhatsAppButton.url(0, "x"))))
        .isInstanceOf(WhatsAppSendException.class);
  }

  @Test
  void message_urlButtonIsRequired_andKindsMustMatchThePosition() {
    List<String> v = List.of("Ana", "Salón", "Corte", "viernes");
    assertThatThrownBy(() -> WhatsAppTemplate.TURNO_CANCELADO.message(TO, v, List.of()))
        .isInstanceOf(WhatsAppSendException.class);
    assertThatThrownBy(
            () ->
                WhatsAppTemplate.TURNO_CANCELADO.message(
                    TO, v, List.of(WhatsAppButton.quickReply(0, "p"))))
        .isInstanceOf(WhatsAppSendException.class);
    assertThatThrownBy(
            () ->
                WhatsAppTemplate.TURNO_CANCELADO.message(
                    TO, v, List.of(WhatsAppButton.url(3, "bella"))))
        .isInstanceOf(WhatsAppSendException.class);
  }

  @Test
  void message_reminderMayOmitQuickReplies_whenTheSalonSwitchesThemOff() {
    WhatsAppOutboundMessage m =
        WhatsAppTemplate.RECORDATORIO_TURNO.message(
            TO,
            List.of("Ana", "Salón", "Corte", "viernes", "15:30"),
            List.of(WhatsAppButton.url(2, "bella/turno/abc")));

    assertThat(m.buttons()).hasSize(1);
  }
}
