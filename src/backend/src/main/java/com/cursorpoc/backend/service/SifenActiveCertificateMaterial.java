package com.cursorpoc.backend.service;

import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.cert.X509Certificate;

/**
 * HU-21: the decrypted certificate + private key a tenant's current operation should use to sign a
 * document (HU-04) or connect to SIFEN (HU-05, HU-10, HU-11, EP-05 homologation). Obtained fresh
 * from {@link SifenCertificateService#requireActiveCertificate(long)} on every call — never cached
 * across calls or shared between tenants (HU-21 AC-04).
 *
 * <p>Never serialize this type (e.g. as a REST response body) — it carries private key material.
 */
public record SifenActiveCertificateMaterial(
    long certificateId,
    KeyStore keyStore,
    String keystorePassword,
    String alias,
    X509Certificate certificate,
    PrivateKey privateKey) {}
