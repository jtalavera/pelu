package com.cursorpoc.backend.service;

import com.google.zxing.BarcodeFormat;
import com.google.zxing.EncodeHintType;
import com.google.zxing.WriterException;
import com.google.zxing.common.BitMatrix;
import com.google.zxing.qrcode.QRCodeWriter;
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.EnumMap;
import java.util.Map;
import javax.imageio.ImageIO;
import org.springframework.stereotype.Service;

/**
 * SIFEN HU-08 AC-13: renders the KuDE's QR code — ISO/IEC 18004 standard, per the Manual Técnico
 * V150 sección 13.8.1's explicit reference. No QR library existed in this repo before this HU; only
 * {@code zxing:core} is used (not the {@code javase} submodule) — the raster is built by hand from
 * the raw {@link BitMatrix} below, since that's a handful of lines and avoids pulling in zxing's
 * AWT-integration submodule for a single conversion.
 */
@Service
public class SifenQrImageService {

  /**
   * Renders {@code content} as a square QR PNG, {@code pixelSize} pixels per side, black modules on
   * white. Includes zxing's default quiet zone (margin hint below) — the manual's minimum physical
   * size (25mm, of which 3mm is quiet zone) is enforced by the caller when placing the image on the
   * page (see {@link SifenKudePdfService#QR_WIDTH_POINTS}), not by pixel count here.
   */
  public byte[] renderPng(String content, int pixelSize) {
    try {
      Map<EncodeHintType, Object> hints = new EnumMap<>(EncodeHintType.class);
      hints.put(EncodeHintType.ERROR_CORRECTION, ErrorCorrectionLevel.M);
      BitMatrix matrix =
          new QRCodeWriter().encode(content, BarcodeFormat.QR_CODE, pixelSize, pixelSize, hints);
      BufferedImage image = toBufferedImage(matrix);
      ByteArrayOutputStream out = new ByteArrayOutputStream();
      ImageIO.write(image, "png", out);
      return out.toByteArray();
    } catch (WriterException e) {
      throw new IllegalStateException("Failed to encode QR code", e);
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  private static BufferedImage toBufferedImage(BitMatrix matrix) {
    int width = matrix.getWidth();
    int height = matrix.getHeight();
    BufferedImage image = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
    for (int x = 0; x < width; x++) {
      for (int y = 0; y < height; y++) {
        image.setRGB(x, y, matrix.get(x, y) ? 0x000000 : 0xFFFFFF);
      }
    }
    return image;
  }
}
