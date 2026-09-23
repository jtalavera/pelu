package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.azure.security.keyvault.secrets.SecretClient;
import com.azure.security.keyvault.secrets.models.KeyVaultSecret;
import com.azure.security.keyvault.secrets.models.SecretProperties;
import com.cursorpoc.backend.service.SifenCertificateSecretStore.RawCertificateMaterial;
import com.cursorpoc.backend.service.SifenCertificateSecretStore.StoredSecretRef;
import java.util.Base64;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

/** RT-12/RT-13/RT-14/RT-15 (Hardening_SIFEN.md). */
@ExtendWith(MockitoExtension.class)
class KeyVaultSifenCertificateSecretStoreTest {

  @Mock private SecretClient secretClient;

  private KeyVaultSifenCertificateSecretStore store;

  @BeforeEach
  void setUp() {
    store = new KeyVaultSifenCertificateSecretStore(secretClient);
  }

  @Test
  void store_writesTwoSecretsNamedWithTheTenantPrefix_andReturnsTheirVersions() {
    when(secretClient.setSecret(any(KeyVaultSecret.class)))
        .thenAnswer(inv -> withVersion(inv.getArgument(0), "v1"));

    StoredSecretRef ref = store.store(7L, new byte[] {1, 2, 3}, "TestPass123!");

    assertThat(ref.p12SecretName()).matches("^sifen-cert-t7-[0-9a-f-]+-p12$");
    assertThat(ref.passwordSecretName()).matches("^sifen-cert-t7-[0-9a-f-]+-pwd$");
    assertThat(ref.p12SecretVersion()).isEqualTo("v1");
    assertThat(ref.passwordSecretVersion()).isEqualTo("v1");
  }

  @Test
  void store_writesTheP12AsBase64_andThePasswordVerbatim() {
    when(secretClient.setSecret(any(KeyVaultSecret.class)))
        .thenAnswer(inv -> withVersion(inv.getArgument(0), "v1"));
    byte[] p12Bytes = {10, 20, 30};

    store.store(1L, p12Bytes, "TestPass123!");

    ArgumentCaptor<KeyVaultSecret> captor = ArgumentCaptor.forClass(KeyVaultSecret.class);
    verify(secretClient, org.mockito.Mockito.times(2)).setSecret(captor.capture());
    var written = captor.getAllValues();
    var p12Written = written.stream().filter(s -> s.getName().endsWith("-p12")).findFirst().get();
    var pwdWritten = written.stream().filter(s -> s.getName().endsWith("-pwd")).findFirst().get();
    assertThat(Base64.getDecoder().decode(p12Written.getValue())).isEqualTo(p12Bytes);
    assertThat(pwdWritten.getValue()).isEqualTo("TestPass123!");
  }

  @Test
  void load_decodesTheP12FromBase64_andReturnsThePasswordVerbatim() {
    StoredSecretRef ref =
        new StoredSecretRef("sifen-cert-t1-abc-p12", "v1", "sifen-cert-t1-abc-pwd", "v1");
    byte[] p12Bytes = {5, 6, 7};
    when(secretClient.getSecret("sifen-cert-t1-abc-p12", "v1"))
        .thenReturn(
            new KeyVaultSecret(
                "sifen-cert-t1-abc-p12", Base64.getEncoder().encodeToString(p12Bytes)));
    when(secretClient.getSecret("sifen-cert-t1-abc-pwd", "v1"))
        .thenReturn(new KeyVaultSecret("sifen-cert-t1-abc-pwd", "TestPass123!"));

    RawCertificateMaterial material = store.load(1L, ref);

    assertThat(material.p12Bytes()).isEqualTo(p12Bytes);
    assertThat(material.password()).isEqualTo("TestPass123!");
  }

  /**
   * RT-13/RT-15: the core invariant this class must uphold — a ref whose secret names don't
   * structurally belong to the requesting tenant is rejected before any Key Vault call is made, so
   * a corrupted/tampered DB row can never make one tenant's call resolve another tenant's material.
   */
  @Test
  void load_rejectsRefWhoseTenantPrefixDoesNotMatchRequestedTenant_withoutCallingKeyVault() {
    StoredSecretRef otherTenantsRef =
        new StoredSecretRef("sifen-cert-t99-abc-p12", "v1", "sifen-cert-t99-abc-pwd", "v1");

    assertThatThrownBy(() -> store.load(1L, otherTenantsRef))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("tenantId=1");
    verifyNoInteractions(secretClient);
  }

  @Test
  void deleteAll_isUnreachableOutsideTestSupport_throwsRatherThanSilentlyNoOp() {
    assertThatThrownBy(() -> store.deleteAll(1L)).isInstanceOf(UnsupportedOperationException.class);
    verify(secretClient, never()).getSecret(any(), any());
  }

  private static KeyVaultSecret withVersion(KeyVaultSecret secret, String version) {
    KeyVaultSecret spy = mock(KeyVaultSecret.class);
    SecretProperties props = mock(SecretProperties.class);
    when(props.getVersion()).thenReturn(version);
    when(spy.getProperties()).thenReturn(props);
    return spy;
  }
}
