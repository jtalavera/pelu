package com.cursorpoc.backend.booking;

import com.cursorpoc.backend.domain.BookingSettings;
import com.cursorpoc.backend.domain.enums.TenantStatus;
import com.cursorpoc.backend.repository.BookingSettingsRepository;
import com.cursorpoc.backend.whatsapp.SalonDisplayName;
import java.util.Optional;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * RT-01 / RT-02: the only way a public request reaches a salon — by slug, never by an id the client
 * sends. A slug that does not exist, a salon whose booking flag is off, that is suspended or that
 * is not accepting bookings all come out as the same empty answer, so nothing public can tell which
 * of those it was.
 */
@Service
public class PublicBookingResolver {

  /** What the public page may know about a salon that is open for bookings. */
  public record OpenSalon(long tenantId, String businessName) {}

  private final BookingSettingsRepository settings;
  private final BookingAccess access;
  private final SalonDisplayName salonNames;

  public PublicBookingResolver(
      BookingSettingsRepository settings, BookingAccess access, SalonDisplayName salonNames) {
    this.settings = settings;
    this.access = access;
    this.salonNames = salonNames;
  }

  @Transactional(readOnly = true)
  public Optional<OpenSalon> resolve(String rawSlug) {
    Optional<String> slug = BookingSlug.normalize(rawSlug);
    if (slug.isEmpty()) {
      return Optional.empty();
    }
    Optional<BookingSettings> found = settings.findBySlug(slug.get());
    if (found.isEmpty()) {
      return Optional.empty();
    }
    BookingSettings s = found.get();
    long tenantId = s.getTenant().getId();
    if (s.getTenant().getStatus() != TenantStatus.ACTIVE
        || !s.isAcceptingBookings()
        || !access.isEnabled(tenantId)) {
      return Optional.empty();
    }
    return Optional.of(new OpenSalon(tenantId, salonNames.of(tenantId, s.getTenant())));
  }
}
