package com.cursorpoc.backend.booking;

import java.util.Locale;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * The salon's public address (RSV-02, criterio 2): 3–40 characters, lower-case letters, digits and
 * hyphens (never at the ends, never doubled), and not one of the words the app itself uses as a
 * route. Uniqueness across the platform is the database's job (a filtered unique index).
 */
public final class BookingSlug {

  public static final int MIN_LENGTH = 3;
  public static final int MAX_LENGTH = 40;

  private static final Pattern FORMAT = Pattern.compile("[a-z0-9]+(?:-[a-z0-9]+)*");

  /** Words that are routes or would read as official pages of the app. */
  static final Set<String> RESERVED =
      Set.of(
          "admin",
          "api",
          "app",
          "login",
          "logout",
          "r",
          "reservar",
          "reservas",
          "reserva",
          "booking",
          "book",
          "turno",
          "turnos",
          "activate",
          "assets",
          "health",
          "static",
          "public",
          "platform",
          "plataforma",
          "www",
          "swagger-ui",
          "whatsapp",
          "webhook",
          "flowbit",
          "femme",
          "pelu",
          "soporte",
          "support",
          "help",
          "ayuda",
          "null",
          "undefined");

  private BookingSlug() {}

  /** The slug in canonical form (trimmed, lower case), or empty when it is not a valid address. */
  public static Optional<String> normalize(String raw) {
    if (raw == null) {
      return Optional.empty();
    }
    String s = raw.trim().toLowerCase(Locale.ROOT);
    if (s.length() < MIN_LENGTH || s.length() > MAX_LENGTH) {
      return Optional.empty();
    }
    if (!FORMAT.matcher(s).matches() || RESERVED.contains(s)) {
      return Optional.empty();
    }
    return Optional.of(s);
  }
}
