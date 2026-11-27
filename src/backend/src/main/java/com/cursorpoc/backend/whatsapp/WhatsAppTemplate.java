package com.cursorpoc.backend.whatsapp;

import java.util.List;

/**
 * HU-WAP-02 (criterio 1): the versioned template catalog. This is the DRAFT submitted to Meta (see
 * {@code requirements/user_stories/Plantillas_WhatsApp_para_Meta.md}); the final text can change if
 * Meta objects, but the ORDER of the variables must not, because the code sends them by position.
 * Everything is strictly transactional (no promotions, criterio 5) and in {@code es}.
 */
public enum WhatsAppTemplate {
  CODIGO_VERIFICACION(
      "pelu_codigo_verificacion",
      Category.AUTHENTICATION,
      1,
      List.of(ButtonSpec.url("Copiar código")),
      null,
      null),
  TURNO_CONFIRMADO(
      "pelu_turno_confirmado",
      Category.UTILITY,
      6,
      List.of(ButtonSpec.url("Ver o cambiar turno")),
      "Hola {{1}}, tu turno en {{2}} está confirmado: {{3}}, el {{4}} a las {{5}} con {{6}}."
          + " Podés verlo o cambiarlo con el botón de abajo.",
      Texts.FOOTER),
  TURNO_PENDIENTE(
      "pelu_turno_pendiente",
      Category.UTILITY,
      5,
      List.of(ButtonSpec.url("Ver mi solicitud")),
      "Hola {{1}}, recibimos tu solicitud de turno en {{2}}: {{3}}, el {{4}} a las {{5}}. El salón"
          + " la va a confirmar y te avisamos por este medio.",
      Texts.FOOTER),
  TURNO_NO_DISPONIBLE(
      "pelu_turno_no_disponible",
      Category.UTILITY,
      4,
      List.of(ButtonSpec.url("Elegir otro horario")),
      "Hola {{1}}, {{2}} no pudo confirmar tu solicitud de {{3}} para el {{4}}. Podés elegir otro"
          + " horario con el botón de abajo.",
      Texts.FOOTER),
  PROPUESTA_HORARIO(
      "pelu_propuesta_horario",
      Category.UTILITY,
      4,
      List.of(ButtonSpec.url("Elegir nuevo horario")),
      "Hola {{1}}, {{2}} te propone cambiar tu turno de {{3}} del {{4}}. Elegí el nuevo horario con"
          + " el botón de abajo.",
      Texts.FOOTER),
  RECORDATORIO_TURNO(
      "pelu_recordatorio_turno",
      Category.UTILITY,
      5,
      List.of(
          ButtonSpec.quickReply("Confirmo"),
          ButtonSpec.quickReply("No puedo ir"),
          ButtonSpec.url("Ver mi turno")),
      "Hola {{1}}, te recordamos tu turno en {{2}}: {{3}}, el {{4}} a las {{5}}. ¿Podés venir?",
      Texts.FOOTER),
  TURNO_CANCELADO(
      "pelu_turno_cancelado",
      Category.UTILITY,
      4,
      List.of(ButtonSpec.url("Ver horarios")),
      "Hola {{1}}, tu turno en {{2}} de {{3}} del {{4}} quedó cancelado.",
      Texts.FOOTER);

  public static final String LANGUAGE = "es";

  /** Holder so the enum constants above can reference it (no forward reference to a static). */
  private static final class Texts {
    static final String FOOTER = "Respondé BAJA para dejar de recibir avisos";
  }

  public enum Category {
    AUTHENTICATION,
    UTILITY
  }

  /** One button of the approved template, in order. */
  public record ButtonSpec(WhatsAppButton.Kind kind, String text) {
    static ButtonSpec url(String text) {
      return new ButtonSpec(WhatsAppButton.Kind.URL, text);
    }

    static ButtonSpec quickReply(String text) {
      return new ButtonSpec(WhatsAppButton.Kind.QUICK_REPLY, text);
    }
  }

  private final String templateName;
  private final Category category;
  private final int bodyVariables;
  private final List<ButtonSpec> buttons;
  private final String bodyText;
  private final String footer;

  WhatsAppTemplate(
      String templateName,
      Category category,
      int bodyVariables,
      List<ButtonSpec> buttons,
      String bodyText,
      String footer) {
    this.templateName = templateName;
    this.category = category;
    this.bodyVariables = bodyVariables;
    this.buttons = buttons;
    this.bodyText = bodyText;
    this.footer = footer;
  }

  public String templateName() {
    return templateName;
  }

  public Category category() {
    return category;
  }

  public int bodyVariables() {
    return bodyVariables;
  }

  public List<ButtonSpec> buttons() {
    return buttons;
  }

  /** Draft body text; {@code null} for the authentication template, whose body Meta generates. */
  public String bodyText() {
    return bodyText;
  }

  public String footer() {
    return footer;
  }

  public static WhatsAppTemplate byName(String name) {
    for (WhatsAppTemplate t : values()) {
      if (t.templateName.equals(name)) {
        return t;
      }
    }
    return null;
  }

  /**
   * Builds a message for this template, sanitizing every variable (criterio 4) and checking it
   * against the catalog: variable count, and that each given button matches the kind of the
   * template's button at that position. URL buttons are required; quick replies may be left out
   * (the salon can switch them off, HU-WAP-06 criterio 10).
   */
  public WhatsAppOutboundMessage message(
      String to, List<String> variables, List<WhatsAppButton> dynamicButtons) {
    List<String> body = variables == null ? List.of() : variables;
    if (body.size() != bodyVariables) {
      throw new WhatsAppSendException(WhatsAppErrorCode.INVALID_REQUEST);
    }
    List<String> sanitized = body.stream().map(WhatsAppTemplateVariables::sanitize).toList();
    if (sanitized.stream().anyMatch(String::isEmpty)) {
      throw new WhatsAppSendException(WhatsAppErrorCode.INVALID_REQUEST);
    }
    List<WhatsAppButton> given = dynamicButtons == null ? List.of() : dynamicButtons;
    for (WhatsAppButton b : given) {
      if (b.index() < 0
          || b.index() >= buttons.size()
          || buttons.get(b.index()).kind() != b.kind()
          || b.value() == null
          || b.value().isBlank()) {
        throw new WhatsAppSendException(WhatsAppErrorCode.INVALID_REQUEST);
      }
    }
    for (int i = 0; i < buttons.size(); i++) {
      if (buttons.get(i).kind() == WhatsAppButton.Kind.URL) {
        final int index = i;
        if (given.stream().noneMatch(b -> b.index() == index)) {
          throw new WhatsAppSendException(WhatsAppErrorCode.INVALID_REQUEST);
        }
      }
    }
    return new WhatsAppOutboundMessage(to, templateName, LANGUAGE, sanitized, given);
  }
}
