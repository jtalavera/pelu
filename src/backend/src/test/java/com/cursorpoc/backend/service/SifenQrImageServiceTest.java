package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;

/** SIFEN HU-08 AC-13: {@link SifenQrImageService} renders a valid, decodable square PNG. */
class SifenQrImageServiceTest {

  private final SifenQrImageService service = new SifenQrImageService();

  @Test
  void renderPng_producesADecodableSquarePng() throws Exception {
    byte[] png =
        service.renderPng("https://ekuatia.set.gov.py/consultas-test/qr?nVersion=150", 300);

    BufferedImage image = ImageIO.read(new ByteArrayInputStream(png));
    assertThat(image).isNotNull();
    assertThat(image.getWidth()).isEqualTo(image.getHeight());
    assertThat(image.getWidth()).isGreaterThanOrEqualTo(300);
  }

  @Test
  void renderPng_differentContent_producesDifferentImages() {
    byte[] a = service.renderPng("https://example.com/a", 200);
    byte[] b = service.renderPng("https://example.com/b", 200);

    assertThat(a).isNotEqualTo(b);
  }
}
