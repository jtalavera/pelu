package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.lenient;

import com.cursorpoc.backend.domain.SalonService;
import com.cursorpoc.backend.domain.ServiceCategory;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.repository.SalonServiceRepository;
import com.cursorpoc.backend.repository.ServiceCategoryRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.web.dto.ServiceCategoryUpsertRequest;
import com.cursorpoc.backend.web.dto.ServiceUpsertRequest;
import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.web.server.ResponseStatusException;

@ExtendWith(MockitoExtension.class)
class ServiceCatalogServiceTest {

  @Mock private TenantRepository tenantRepository;
  @Mock private ServiceCategoryRepository serviceCategoryRepository;
  @Mock private SalonServiceRepository salonServiceRepository;

  @InjectMocks private ServiceCatalogService service;

  private Tenant tenant;
  private ServiceCategory catHair;
  private ServiceCategory catBeard;

  private final AtomicLong ids = new AtomicLong(1);

  @BeforeEach
  void setUp() {
    tenant = new Tenant();
    tenant.setId(1L);
    tenant.setName("Demo");
    lenient().when(tenantRepository.findById(1L)).thenReturn(Optional.of(tenant));

    catHair = new ServiceCategory();
    catHair.setId(10L);
    catHair.setTenant(tenant);
    catHair.setName("Hair");
    catHair.setActive(true);

    catBeard = new ServiceCategory();
    catBeard.setId(11L);
    catBeard.setTenant(tenant);
    catBeard.setName("Beard");
    catBeard.setActive(false);

    lenient()
        .when(serviceCategoryRepository.findByIdAndTenant_Id(10L, 1L))
        .thenReturn(Optional.of(catHair));
    lenient()
        .when(serviceCategoryRepository.findByIdAndTenant_Id(11L, 1L))
        .thenReturn(Optional.of(catBeard));

    lenient()
        .when(serviceCategoryRepository.save(any(ServiceCategory.class)))
        .thenAnswer(
            inv -> {
              ServiceCategory c = inv.getArgument(0);
              if (c.getId() == null) {
                c.setId(ids.getAndIncrement());
              }
              return c;
            });
    lenient()
        .when(salonServiceRepository.save(any(SalonService.class)))
        .thenAnswer(
            inv -> {
              SalonService s = inv.getArgument(0);
              if (s.getId() == null) {
                s.setId(ids.getAndIncrement());
              }
              return s;
            });
  }

  @Test
  void createCategory_trimsName() {
    var res = service.createCategory(1L, new ServiceCategoryUpsertRequest("  Cuts  "));
    assertThat(res.name()).isEqualTo("Cuts");
    assertThat(res.active()).isTrue();
  }

  @Test
  void listServices_filtersByCategoryAndQueryMatchesCategoryOrName() {
    SalonService s1 = new SalonService();
    s1.setId(100L);
    s1.setTenant(tenant);
    s1.setCategory(catHair);
    s1.setName("Basic Cut");
    s1.setPriceMinor(new BigDecimal("10000.00"));
    s1.setDurationMinutes(30);
    s1.setActive(true);

    SalonService s2 = new SalonService();
    s2.setId(101L);
    s2.setTenant(tenant);
    s2.setCategory(catHair);
    s2.setName("Color");
    s2.setPriceMinor(new BigDecimal("50000.00"));
    s2.setDurationMinutes(60);
    s2.setActive(true);

    lenient()
        .when(salonServiceRepository.findByTenant_IdOrderByNameAsc(1L))
        .thenReturn(List.of(s1, s2));

    assertThat(service.listServices(1L, Optional.of(10L), "cut")).hasSize(1);
    assertThat(service.listServices(1L, Optional.of(10L), "hair")).hasSize(2);
    assertThat(service.listServices(1L, Optional.empty(), "color")).hasSize(1);
  }

  @Test
  void createService_rejectsInactiveCategory() {
    assertThatThrownBy(
            () ->
                service.createService(
                    1L, new ServiceUpsertRequest("Trim", 11L, new BigDecimal("1.00"), 15)))
        .isInstanceOf(ResponseStatusException.class);
  }
}

