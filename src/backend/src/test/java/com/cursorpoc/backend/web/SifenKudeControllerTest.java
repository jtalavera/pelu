package com.cursorpoc.backend.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.config.SifenConnectionProperties;
import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.service.SifenKudeEmailService;
import com.cursorpoc.backend.service.SifenKudePdfService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.web.server.ResponseStatusException;

class SifenKudeControllerTest {

  private static final FemmeUserPrincipal PRINCIPAL =
      new FemmeUserPrincipal(7L, 1L, "demo@example.com", UserRole.ADMIN, null);

  private SifenKudePdfService pdfService;
  private SifenKudeEmailService emailService;
  private SifenConnectionProperties connectionProperties;
  private SifenKudeController controller;

  @BeforeEach
  void setUp() {
    pdfService = mock(SifenKudePdfService.class);
    emailService = mock(SifenKudeEmailService.class);
    connectionProperties = new SifenConnectionProperties();
    controller = new SifenKudeController(pdfService, emailService, connectionProperties);
  }

  @Test
  void download_withoutSample_rendersTheRealKude() {
    connectionProperties.setEnvironment(SifenConnectionProperties.Environment.TEST);
    when(pdfService.buildKudePdf(1L, 100L))
        .thenReturn(new SifenKudePdfService.KudePdfResult(new byte[] {1}, "KUDE-x.pdf"));

    var response = controller.download(100L, false, PRINCIPAL);

    assertThat(response.getHeaders().getFirst(HttpHeaders.CONTENT_DISPOSITION))
        .contains("KUDE-x.pdf");
    verify(pdfService).buildKudePdf(1L, 100L);
  }

  @Test
  void download_sampleInTest_rendersTheProductionSampleKude() {
    connectionProperties.setEnvironment(SifenConnectionProperties.Environment.TEST);
    when(pdfService.buildProductionSampleKudePdf(1L, 100L))
        .thenReturn(new SifenKudePdfService.KudePdfResult(new byte[] {1}, "MUESTRA-KUDE-x.pdf"));

    var response = controller.download(100L, true, PRINCIPAL);

    assertThat(response.getHeaders().getFirst(HttpHeaders.CONTENT_DISPOSITION))
        .contains("MUESTRA-KUDE-x.pdf");
    verify(pdfService).buildProductionSampleKudePdf(1L, 100L);
  }

  @Test
  void download_sampleInProduction_isRejected() {
    connectionProperties.setEnvironment(SifenConnectionProperties.Environment.PRODUCTION);

    assertThatThrownBy(() -> controller.download(100L, true, PRINCIPAL))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("SIFEN_KUDE_SAMPLE_ONLY_IN_TEST");
    verifyNoInteractions(pdfService);
  }

  @Test
  void download_realKudeInProduction_stillWorks() {
    connectionProperties.setEnvironment(SifenConnectionProperties.Environment.PRODUCTION);
    when(pdfService.buildKudePdf(1L, 100L))
        .thenReturn(new SifenKudePdfService.KudePdfResult(new byte[] {1}, "KUDE-x.pdf"));

    var response = controller.download(100L, false, PRINCIPAL);

    assertThat(response.getStatusCode().value()).isEqualTo(200);
  }

  @Test
  void download_withoutPrincipal_isUnauthorized() {
    assertThatThrownBy(() -> controller.download(100L, false, null))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("UNAUTHORIZED");
    verifyNoInteractions(pdfService);
  }
}
