package com.cursorpoc.backend.whatsapp;

import java.util.ArrayList;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Platform-level WhatsApp configuration (HU-WAP-01, criterios 5, 6 y 9). The values come from
 * environment variables / Key Vault; nothing is hardcoded.
 *
 * <p>{@code provider=meta} needs every credential below; {@code provider=fake} (e2e and tests only)
 * needs none. With {@code enabled=true} but a credential missing the channel is treated as OFF and
 * {@link #configurationProblems()} says which values are missing (shown to platform admins).
 */
@Component
public class WhatsAppSettings {

  public static final String PROVIDER_META = "meta";
  public static final String PROVIDER_FAKE = "fake";

  private final boolean enabled;
  private final String provider;
  private final String accessToken;
  private final String phoneNumberId;
  private final String businessAccountId;
  private final String appSecret;
  private final String verifyToken;
  private final String apiVersion;
  private final String baseUrl;
  private final int connectTimeoutMs;
  private final int requestTimeoutMs;
  private final int otpTimeoutMs;

  public WhatsAppSettings(
      @Value("${app.femme.whatsapp.enabled:false}") boolean enabled,
      @Value("${app.femme.whatsapp.provider:meta}") String provider,
      @Value("${app.femme.whatsapp.access-token:}") String accessToken,
      @Value("${app.femme.whatsapp.phone-number-id:}") String phoneNumberId,
      @Value("${app.femme.whatsapp.business-account-id:}") String businessAccountId,
      @Value("${app.femme.whatsapp.app-secret:}") String appSecret,
      @Value("${app.femme.whatsapp.webhook-verify-token:}") String verifyToken,
      @Value("${app.femme.whatsapp.api-version:v21.0}") String apiVersion,
      @Value("${app.femme.whatsapp.base-url:https://graph.facebook.com}") String baseUrl,
      @Value("${app.femme.whatsapp.connect-timeout-ms:3000}") int connectTimeoutMs,
      @Value("${app.femme.whatsapp.request-timeout-ms:15000}") int requestTimeoutMs,
      @Value("${app.femme.whatsapp.otp-timeout-ms:5000}") int otpTimeoutMs) {
    this.enabled = enabled;
    this.provider = provider == null ? PROVIDER_META : provider.trim().toLowerCase();
    this.accessToken = nullToEmpty(accessToken);
    this.phoneNumberId = nullToEmpty(phoneNumberId);
    this.businessAccountId = nullToEmpty(businessAccountId);
    this.appSecret = nullToEmpty(appSecret);
    this.verifyToken = nullToEmpty(verifyToken);
    this.apiVersion = apiVersion;
    this.baseUrl = baseUrl;
    this.connectTimeoutMs = connectTimeoutMs;
    this.requestTimeoutMs = requestTimeoutMs;
    this.otpTimeoutMs = otpTimeoutMs;
  }

  private static String nullToEmpty(String s) {
    return s == null ? "" : s;
  }

  public boolean isEnabled() {
    return enabled;
  }

  public String getProvider() {
    return provider;
  }

  public boolean isFake() {
    return PROVIDER_FAKE.equals(provider);
  }

  public String getAccessToken() {
    return accessToken;
  }

  public String getPhoneNumberId() {
    return phoneNumberId;
  }

  public String getBusinessAccountId() {
    return businessAccountId;
  }

  public String getAppSecret() {
    return appSecret;
  }

  public String getVerifyToken() {
    return verifyToken;
  }

  public String getApiVersion() {
    return apiVersion;
  }

  public String getBaseUrl() {
    return baseUrl;
  }

  public int getConnectTimeoutMs() {
    return connectTimeoutMs;
  }

  public int getRequestTimeoutMs() {
    return requestTimeoutMs;
  }

  public int getOtpTimeoutMs() {
    return otpTimeoutMs;
  }

  /**
   * Names of the missing mandatory values (never their contents). Only relevant when the channel is
   * enabled with the real provider; the fake provider needs nothing.
   */
  public List<String> configurationProblems() {
    List<String> missing = new ArrayList<>();
    if (!enabled || isFake()) {
      return missing;
    }
    if (!PROVIDER_META.equals(provider)) {
      missing.add("provider");
    }
    if (accessToken.isBlank()) {
      missing.add("WHATSAPP_ACCESS_TOKEN");
    }
    if (phoneNumberId.isBlank()) {
      missing.add("WHATSAPP_PHONE_NUMBER_ID");
    }
    if (businessAccountId.isBlank()) {
      missing.add("WHATSAPP_BUSINESS_ACCOUNT_ID");
    }
    if (appSecret.isBlank()) {
      missing.add("WHATSAPP_APP_SECRET");
    }
    if (verifyToken.isBlank()) {
      missing.add("WHATSAPP_WEBHOOK_VERIFY_TOKEN");
    }
    return missing;
  }

  /** The platform switch is on AND the configuration is complete. */
  public boolean isOperational() {
    return enabled && configurationProblems().isEmpty();
  }
}
