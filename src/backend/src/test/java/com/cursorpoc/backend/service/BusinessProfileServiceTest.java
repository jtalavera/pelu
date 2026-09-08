package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import com.cursorpoc.backend.domain.BusinessProfile;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.repository.BusinessProfileRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.web.dto.BusinessProfileUpdateRequest;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.web.server.ResponseStatusException;

@ExtendWith(MockitoExtension.class)
class BusinessProfileServiceTest {

  @Mock private TenantRepository tenantRepository;
  @Mock private BusinessProfileRepository businessProfileRepository;

  @InjectMocks private BusinessProfileService service;

  private BusinessProfile profile;

  @BeforeEach
  void setUp() {
    Tenant tenant = new Tenant();
    tenant.setId(5L);
    tenant.setName("Salon");
    profile = new BusinessProfile();
    profile.setTenant(tenant);
    profile.setTenantId(5L);
    profile.setBusinessName("Salon");
    lenient().when(businessProfileRepository.findByTenantId(5L)).thenReturn(Optional.of(profile));
  }

  @Test
  void update_rejectsInvalidRuc() {
    var req = new BusinessProfileUpdateRequest("Salon X", "not-a-ruc", null, null, null, null);
    assertThatThrownBy(() -> service.update(5L, req)).isInstanceOf(ResponseStatusException.class);
  }

  @Test
  void update_acceptsValidRucAndClearsLogoWhenBlank() {
    var req =
        new BusinessProfileUpdateRequest("Salon X", "80000005-6", "Addr", "021", "a@b.com", "");
    service.update(5L, req);
    assertThat(profile.getRuc()).isEqualTo("80000005-6");
    assertThat(profile.getLogoDataUrl()).isNull();
  }

  @Test
  void update_persistsSifenFantasyName_andReturnsItInTheResponse() {
    var req =
        new BusinessProfileUpdateRequest(
            "Salon X",
            "80000005-6",
            "Addr",
            "021",
            "a@b.com",
            null,
            "INDIVIDUAL",
            "96020",
            "Peluquería",
            null,
            null,
            null,
            null,
            "Peluquería Lucía",
            null);

    var response = service.update(5L, req);

    assertThat(profile.getSifenFantasyName()).isEqualTo("Peluquería Lucía");
    assertThat(response.sifenFantasyName()).isEqualTo("Peluquería Lucía");
  }

  @Test
  void update_blankSifenFantasyName_clearsIt() {
    profile.setSifenFantasyName("Antiguo");
    var req =
        new BusinessProfileUpdateRequest(
            "Salon X",
            "80000005-6",
            "Addr",
            "021",
            "a@b.com",
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            "  ",
            null);

    service.update(5L, req);

    assertThat(profile.getSifenFantasyName()).isNull();
  }

  @Test
  void isRucReadyForInvoicing_falseWhenMissing() {
    profile.setRuc(null);
    assertThat(service.isRucReadyForInvoicing(5L)).isFalse();
  }

  @Test
  void isRucReadyForInvoicing_trueWhenValid() {
    profile.setRuc("80000005-6");
    assertThat(service.isRucReadyForInvoicing(5L)).isTrue();
  }

  /**
   * A tenant with no profile row yet (a freshly-provisioned tenant, before its admin ever visits
   * Settings) simply isn't RUC-ready — this must NOT lazily create a default profile as a side
   * effect. DashboardService calls this method twice within one read-only transaction (once
   * directly, once in its no-active-fiscal-stamp branch); a lazy-create here previously caused a
   * {@code NonUniqueObjectException} on the second call, since the first call's unflushed insert
   * isn't visible to a fresh lookup in the same persistence context — breaking the Dashboard for
   * every newly-created tenant's very first login.
   */
  @Test
  void isRucReadyForInvoicing_falseAndNoSideEffectWhenProfileDoesNotExist() {
    assertThat(service.isRucReadyForInvoicing(99L)).isFalse();
    verify(businessProfileRepository, never()).save(any());
  }
}
