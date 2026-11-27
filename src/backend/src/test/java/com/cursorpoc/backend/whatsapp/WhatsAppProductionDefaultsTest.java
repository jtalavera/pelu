package com.cursorpoc.backend.whatsapp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.cursorpoc.backend.web.WhatsAppTestSupportController;
import java.time.Duration;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContext;
import org.springframework.test.context.ActiveProfiles;

/**
 * The shape of a real deployment: provider {@code meta} (the default), channel not configured and
 * no e2e data init. The fake provider and its support controller must not exist (HU-WAP-01,
 * criterio 7 and RSV-05's warning), and nothing may reach Meta.
 */
@SpringBootTest(
    properties = {
      "app.femme.whatsapp.provider=meta",
      "app.femme.whatsapp.enabled=true",
      "app.femme.whatsapp.access-token=",
      "app.femme.whatsapp.phone-number-id=",
      "app.femme.whatsapp.business-account-id=",
      "app.femme.whatsapp.app-secret=",
      "app.femme.whatsapp.webhook-verify-token=",
      "femme.data-init.enabled=false"
    })
@ActiveProfiles("test")
class WhatsAppProductionDefaultsTest {

  @Autowired ApplicationContext context;
  @Autowired WhatsAppGateway gateway;
  @Autowired WhatsAppSettings settings;
  @Autowired PlatformAlertService alerts;

  @Test
  void theFakeProviderAndTheTestSupportControllerDoNotExist() {
    assertThat(gateway).isInstanceOf(MetaCloudWhatsAppGateway.class);
    assertThat(context.getBeanNamesForType(FakeWhatsAppGateway.class)).isEmpty();
    assertThat(context.getBeanNamesForType(FakeFallbackEmailSender.class)).isEmpty();
    assertThat(context.getBean(FallbackEmailSender.class)).isInstanceOf(EmailFallbackSender.class);
    assertThat(context.getBeanNamesForType(WhatsAppTestSupportController.class)).isEmpty();
  }

  @Test
  void enabledButIncomplete_isTreatedAsOff_andReportedWithNamesOnly() {
    assertThat(settings.isOperational()).isFalse();
    assertThat(settings.configurationProblems())
        .containsExactlyInAnyOrder(
            "WHATSAPP_ACCESS_TOKEN",
            "WHATSAPP_PHONE_NUMBER_ID",
            "WHATSAPP_BUSINESS_ACCOUNT_ID",
            "WHATSAPP_APP_SECRET",
            "WHATSAPP_WEBHOOK_VERIFY_TOKEN");
    assertThatThrownBy(
            () ->
                gateway.send(
                    WhatsAppTemplate.TURNO_CANCELADO.message(
                        "+595981123456",
                        List.of("Ana", "Salón", "Corte", "viernes"),
                        List.of(WhatsAppButton.url(0, "bella"))),
                    Duration.ofSeconds(1)))
        .isInstanceOfSatisfying(
            WhatsAppSendException.class,
            e -> assertThat(e.getCode()).isEqualTo(WhatsAppErrorCode.CHANNEL_UNAVAILABLE));
  }

  @Test
  void theStartupCheckRaisedAPlatformAlert() {
    assertThat(alerts.listOpen())
        .anySatisfy(
            a -> {
              assertThat(a.getCategory()).isEqualTo("WHATSAPP_CONFIG_INCOMPLETE");
              assertThat(a.getDetail()).contains("WHATSAPP_ACCESS_TOKEN");
            });
  }
}
