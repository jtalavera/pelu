package com.cursorpoc.backend.web;

import com.cursorpoc.backend.booking.PublicBookingResolver;
import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The public online booking API (no login). Everything under {@code /api/public/booking/**} is
 * {@code permitAll}: the salon is resolved ONLY from the slug in the path (RT-02) and the answer
 * lists only what a stranger may see (RT-03). A slug that does not exist, a salon with the flag
 * off, suspended or not accepting bookings all answer the identical neutral body (RT-01).
 */
@RestController
@RequestMapping("/api/public/booking")
public class PublicBookingController {

  private static final Logger log = LoggerFactory.getLogger(PublicBookingController.class);

  /** {@code businessName} is absent (not null) when the salon is not available. */
  @JsonInclude(JsonInclude.Include.NON_NULL)
  public record PublicBookingInfoResponse(boolean available, String businessName) {}

  private final PublicBookingResolver resolver;

  public PublicBookingController(PublicBookingResolver resolver) {
    this.resolver = resolver;
  }

  @GetMapping("/{slug}")
  public ResponseEntity<PublicBookingInfoResponse> info(@PathVariable String slug) {
    log.info("GET /api/public/booking/{slug} method=GET tenantId=n/a");
    Optional<PublicBookingResolver.OpenSalon> salon = resolver.resolve(slug);
    PublicBookingInfoResponse body =
        salon
            .map(s -> new PublicBookingInfoResponse(true, s.businessName()))
            .orElseGet(() -> new PublicBookingInfoResponse(false, null));
    log.info(
        "GET /api/public/booking/{slug} method=GET tenantId={} status=200",
        salon.map(s -> String.valueOf(s.tenantId())).orElse("n/a"));
    // A salon turning bookings off must cut the page at once: nothing may be cached.
    return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(body);
  }
}
