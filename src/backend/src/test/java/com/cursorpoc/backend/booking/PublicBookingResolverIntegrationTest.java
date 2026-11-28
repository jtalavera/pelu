package com.cursorpoc.backend.booking;

import static org.assertj.core.api.Assertions.assertThat;

import com.cursorpoc.backend.domain.BookingSettings;
import com.cursorpoc.backend.domain.FeatureFlag;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.Tier;
import com.cursorpoc.backend.domain.enums.TenantStatus;
import com.cursorpoc.backend.repository.BookingSettingsRepository;
import com.cursorpoc.backend.repository.FeatureFlagRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.repository.TierRepository;
import com.cursorpoc.backend.web.PublicBookingController;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * RT-01 / RT-02 against the real context: a salon is reached only by its slug, and every way of
 * being unavailable (unknown slug, flag off, suspended, not accepting) answers the identical
 * neutral body, so nothing public can tell which one it was.
 */
@SpringBootTest
@ActiveProfiles("test")
class PublicBookingResolverIntegrationTest {

  private static final AtomicLong SEQ = new AtomicLong();

  @Autowired PublicBookingController controller;
  @Autowired BookingSettingsRepository settings;
  @Autowired TenantRepository tenants;
  @Autowired TierRepository tiers;
  @Autowired FeatureFlagRepository flags;

  private Tenant tenant;
  private String slug;
  private boolean flagBefore;

  @BeforeEach
  void setUp() {
    FeatureFlag flag = flags.findByFlagKey(BookingAccess.FLAG).orElseGet(FeatureFlag::new);
    flagBefore = flag.isEnabled();
    setFlag(true);

    Tier tier = new Tier();
    tier.setName("t-" + SEQ.incrementAndGet() + "-" + System.nanoTime());
    tier = tiers.save(tier);
    tenant = new Tenant();
    tenant.setName("Salón Bella " + SEQ.incrementAndGet());
    tenant.setTier(tier);
    tenant = tenants.save(tenant);
    slug = "bella-" + System.nanoTime();
  }

  @AfterEach
  void tearDown() {
    setFlag(flagBefore);
  }

  private void setFlag(boolean on) {
    FeatureFlag f = flags.findByFlagKey(BookingAccess.FLAG).orElseGet(FeatureFlag::new);
    f.setFlagKey(BookingAccess.FLAG);
    f.setEnabled(on);
    flags.save(f);
  }

  private BookingSettings salon(String slugValue, boolean accepting) {
    BookingSettings s = new BookingSettings(tenant);
    s.setSlug(slugValue);
    s.setAcceptingBookings(accepting);
    return settings.save(s);
  }

  private PublicBookingController.PublicBookingInfoResponse ask(String s) {
    var response = controller.info(s);
    assertThat(response.getStatusCode().value()).isEqualTo(200);
    assertThat(response.getHeaders().getCacheControl()).contains("no-store");
    return response.getBody();
  }

  private static final PublicBookingController.PublicBookingInfoResponse NEUTRAL =
      new PublicBookingController.PublicBookingInfoResponse(false, null);

  @Test
  void anOpenSalonShowsOnlyItsName() {
    salon(slug, true);
    var body = ask(slug);
    assertThat(body.available()).isTrue();
    assertThat(body.businessName()).isEqualTo(tenant.getName());
  }

  @Test
  void theSlugIsCaseInsensitive() {
    salon(slug, true);
    assertThat(ask(slug.toUpperCase()).available()).isTrue();
  }

  @Test
  void everyKindOfUnavailableAnswersTheSameNeutralBody() {
    // unknown slug
    assertThat(ask("no-such-salon")).isEqualTo(NEUTRAL);
    // malformed / reserved slug
    assertThat(ask("admin")).isEqualTo(NEUTRAL);
    assertThat(ask("..%2f")).isEqualTo(NEUTRAL);

    BookingSettings s = salon(slug, false);
    // not accepting bookings
    assertThat(ask(slug)).isEqualTo(NEUTRAL);

    // flag off for everybody
    s.setAcceptingBookings(true);
    settings.save(s);
    setFlag(false);
    assertThat(ask(slug)).isEqualTo(NEUTRAL);
    setFlag(true);
    assertThat(ask(slug).available()).isTrue();

    // suspended salon
    tenant.setStatus(TenantStatus.SUSPENDED);
    tenants.save(tenant);
    assertThat(ask(slug)).isEqualTo(NEUTRAL);
  }

  @Test
  void twoSalonsNeverMix() {
    salon(slug, true);
    Tenant other = new Tenant();
    other.setName("Otro Salón " + SEQ.incrementAndGet());
    other.setTier(tenant.getTier());
    other = tenants.save(other);
    BookingSettings o = new BookingSettings(other);
    String otherSlug = "otro-" + System.nanoTime();
    o.setSlug(otherSlug);
    o.setAcceptingBookings(true);
    settings.save(o);

    assertThat(ask(slug).businessName()).isEqualTo(tenant.getName());
    assertThat(ask(otherSlug).businessName()).isEqualTo(other.getName());
  }
}
