package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.cursorpoc.backend.service.SifenCertificateSecretStore.RawCertificateMaterial;
import com.cursorpoc.backend.service.SifenCertificateSecretStore.StoredSecretRef;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * RT-08 (Especificacion_SIFEN_Peluqueria.md, confirmed unchanged by Hardening_SIFEN.md): the {@code
 * e2e}/local implementation of {@link SifenCertificateSecretStore}.
 */
class LocalFileSifenCertificateSecretStoreTest {

  @TempDir private Path tempDir;

  @Test
  void store_thenLoad_roundTripsArbitraryBinaryContentAndPassword() {
    var store = new LocalFileSifenCertificateSecretStore(tempDir.toString());
    byte[] p12Bytes = {0, 1, 2, (byte) 0xFF, (byte) 0x80, 127, -128};

    StoredSecretRef ref = store.store(1L, p12Bytes, "TestPass123!");
    RawCertificateMaterial loaded = store.load(1L, ref);

    assertThat(loaded.p12Bytes()).isEqualTo(p12Bytes);
    assertThat(loaded.password()).isEqualTo("TestPass123!");
  }

  @Test
  void store_namesSecretsWithTenantPrefix() {
    var store = new LocalFileSifenCertificateSecretStore(tempDir.toString());

    StoredSecretRef ref = store.store(42L, new byte[] {1}, "pw");

    assertThat(ref.p12SecretName()).matches("^sifen-cert-t42-[0-9a-f-]+-p12$");
    assertThat(ref.passwordSecretName()).matches("^sifen-cert-t42-[0-9a-f-]+-pwd$");
  }

  /** RT-15: a ref stored for one tenant can never be loaded under another tenant's id. */
  @Test
  void load_rejectsRefWhoseTenantPrefixDoesNotMatchRequestedTenant() {
    var store = new LocalFileSifenCertificateSecretStore(tempDir.toString());
    StoredSecretRef tenantOnesRef = store.store(1L, new byte[] {1}, "pw");

    assertThatThrownBy(() -> store.load(2L, tenantOnesRef))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("tenantId=2");
  }

  @Test
  void deleteAll_removesEveryFileForTheTenant_leavesOtherTenantsUntouched() {
    var store = new LocalFileSifenCertificateSecretStore(tempDir.toString());
    StoredSecretRef tenantOnesRef = store.store(1L, new byte[] {1}, "pw1");
    StoredSecretRef tenantTwosRef = store.store(2L, new byte[] {2}, "pw2");

    store.deleteAll(1L);

    assertThatThrownBy(() -> store.load(1L, tenantOnesRef)).isInstanceOf(RuntimeException.class);
    // Tenant 2's material survives tenant 1's cleanup.
    assertThat(store.load(2L, tenantTwosRef).password()).isEqualTo("pw2");
  }

  @Test
  void deleteAll_onATenantWithNothingStored_isANoOp() {
    var store = new LocalFileSifenCertificateSecretStore(tempDir.toString());

    store.deleteAll(999L);

    assertThat(Files.exists(tempDir.resolve("t999"))).isFalse();
  }
}
