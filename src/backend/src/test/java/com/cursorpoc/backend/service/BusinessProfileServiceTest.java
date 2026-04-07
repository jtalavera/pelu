package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;

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
    when(businessProfileRepository.findByTenantId(5L)).thenReturn(Optional.of(profile));
  }

  @Test
  void update_rejectsInvalidRuc() {
    var req =
        new BusinessProfileUpdateRequest(
            "Salon X", "80000005-5", null, null, null, null); // wrong DV
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
  void isRucReadyForInvoicing_falseWhenMissing() {
    profile.setRuc(null);
    assertThat(service.isRucReadyForInvoicing(5L)).isFalse();
  }

  @Test
  void isRucReadyForInvoicing_trueWhenValid() {
    profile.setRuc("80000005-6");
    assertThat(service.isRucReadyForInvoicing(5L)).isTrue();
  }
}
