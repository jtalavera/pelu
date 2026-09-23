package com.cursorpoc.backend.service;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;
import java.util.List;

/**
 * Shared helper for every EP-05 homologación live test that needs the real pilot {@code .p12}
 * (HU-12's {@code SifenHomologationConnectivityLiveTest}, HU-13's {@code
 * SifenHomologationInvoiceSubmissionLiveTest}, and any later Fase 4 story that follows the same
 * pattern): locates the gitignored certificate/password under {@code requirements/sifen/} and loads
 * a {@link KeyStore} from it. Extracted out of HU-12's test (which had this inline) so HU-13
 * doesn't duplicate it — every method returns {@code null} (never throws) when the files aren't
 * present, so callers can feed the result straight into {@code
 * org.junit.jupiter.api.Assumptions#assumeTrue}.
 */
final class SifenPilotCertificateTestSupport {

  private SifenPilotCertificateTestSupport() {}

  static KeyStore loadKeyStore(byte[] bytes, String password) throws Exception {
    KeyStore keyStore = KeyStore.getInstance("PKCS12");
    keyStore.load(new ByteArrayInputStream(bytes), password.toCharArray());
    return keyStore;
  }

  /** The gitignored pilot cert lives at {@code requirements/sifen/*.p12} — filename varies. */
  static Path findPilotCertificate() throws IOException {
    Path dir = findRequirementsSifenDir();
    if (dir == null) {
      return null;
    }
    try (var stream = Files.list(dir)) {
      return stream.filter(p -> p.toString().endsWith(".p12")).findFirst().orElse(null);
    }
  }

  static Path findPilotPassword() {
    Path dir = findRequirementsSifenDir();
    if (dir == null) {
      return null;
    }
    Path password = dir.resolve(".secrets/lucia-cert-password.txt");
    return Files.exists(password) ? password : null;
  }

  /**
   * Gradle's test working directory is the backend module ({@code src/backend}), but this test may
   * also be invoked from the repo root by tooling — try both.
   */
  private static Path findRequirementsSifenDir() {
    for (String candidate :
        List.of("requirements/sifen", "../../requirements/sifen", "../../../requirements/sifen")) {
      Path path = Path.of(candidate).toAbsolutePath().normalize();
      if (Files.isDirectory(path)) {
        return path;
      }
    }
    return null;
  }
}
