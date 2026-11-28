package com.cursorpoc.backend.booking;

import com.cursorpoc.backend.config.FrontendUrl;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/**
 * Server-side configuration of the online booking: the secret that signs management links (RSV-06,
 * {@code app.femme.booking.token-secret}, from Key Vault as {@code app-femme-booking-token-secret})
 * and the public address links are built from. Without the secret a salon cannot turn bookings on
 * ({@code 409 BOOKING_NOT_CONFIGURED}), like {@code STOCK_NOT_CONFIGURED}.
 */
@Component
public class BookingConfig {

  static final int MIN_SECRET_LENGTH = 32;

  private final String tokenSecret;
  private final String publicBaseUrl;

  public BookingConfig(
      @Value("${app.femme.booking.token-secret:}") String tokenSecret,
      @Value(FrontendUrl.PRIMARY_EXPR) String publicBaseUrl) {
    this.tokenSecret = tokenSecret == null ? "" : tokenSecret;
    this.publicBaseUrl = publicBaseUrl == null ? "" : publicBaseUrl.replaceAll("/+$", "");
  }

  public boolean isConfigured() {
    return tokenSecret.length() >= MIN_SECRET_LENGTH;
  }

  public void requireConfigured() {
    if (!isConfigured()) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "BOOKING_NOT_CONFIGURED");
    }
  }

  /** The secret, for the code that signs links. Never log it. */
  public String tokenSecret() {
    requireConfigured();
    return tokenSecret;
  }

  /** The salon's public page, e.g. {@code https://app.example.com/r/bella}. */
  public String publicUrl(String slug) {
    return publicBaseUrl + "/r/" + slug;
  }
}
