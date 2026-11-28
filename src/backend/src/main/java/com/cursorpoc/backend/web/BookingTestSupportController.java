package com.cursorpoc.backend.web;

import com.cursorpoc.backend.booking.BookingSlug;
import com.cursorpoc.backend.domain.BookingSettings;
import com.cursorpoc.backend.repository.BookingSettingsRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import java.util.Map;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * e2e only ({@code femme.data-init.enabled=true}, like {@link AppointmentTestSupportController}):
 * sets the caller's salon address and «Aceptar reservas» switch directly, until the real
 * configuration screen exists (RSV-02, A2). MUST stay disabled in production; the screen will
 * replace its use.
 */
@RestController
@RequestMapping("/api/admin/booking-test-support")
@ConditionalOnProperty(name = "femme.data-init.enabled", havingValue = "true")
public class BookingTestSupportController {

  public record SettingsRequest(String slug, Boolean accepting) {}

  private final BookingSettingsRepository settings;
  private final TenantRepository tenants;

  public BookingTestSupportController(
      BookingSettingsRepository settings, TenantRepository tenants) {
    this.settings = settings;
    this.tenants = tenants;
  }

  @PostMapping("/settings")
  @Transactional
  public Map<String, Object> set(
      @AuthenticationPrincipal FemmeUserPrincipal p, @RequestBody SettingsRequest body) {
    if (p == null || !p.hasTenant()) {
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "FORBIDDEN");
    }
    BookingSettings s =
        settings
            .findByTenantId(p.getTenantId())
            .orElseGet(() -> new BookingSettings(tenants.getReferenceById(p.getTenantId())));
    if (body.slug() != null) {
      String slug = BookingSlug.normalize(body.slug()).orElse(null);
      if (slug == null) {
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "BOOKING_SLUG_INVALID");
      }
      s.setSlug(slug);
    }
    if (body.accepting() != null) {
      s.setAcceptingBookings(body.accepting());
    }
    settings.save(s);
    return Map.of("ok", true);
  }
}
