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
import org.springframework.http.HttpStatus;
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
    var res = service.createCategory(1L, new ServiceCategoryUpsertRequest("  Cuts  ", null));
    assertThat(res.name()).isEqualTo("Cuts");
    assertThat(res.active()).isTrue();
    assertThat(res.accentKey()).isEqualTo("stone");
  }

  @Test
  void createCategory_withAccent_setsAccent() {
    var res = service.createCategory(1L, new ServiceCategoryUpsertRequest("Cuts", "mauve"));
    assertThat(res.accentKey()).isEqualTo("mauve");
  }

  @Test
  void createCategory_invalidAccent_throwsBadRequest() {
    assertThatThrownBy(
            () -> service.createCategory(1L, new ServiceCategoryUpsertRequest("Cuts", "neon")))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(
            ex ->
                assertThat(((ResponseStatusException) ex).getStatusCode())
                    .isEqualTo(HttpStatus.BAD_REQUEST));
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

  @Test
  void activateService_inactiveServiceActiveCategory_setsActiveTrue() {
    SalonService svc = new SalonService();
    svc.setId(200L);
    svc.setTenant(tenant);
    svc.setCategory(catHair);
    svc.setName("Basic Cut");
    svc.setPriceMinor(new BigDecimal("10000.00"));
    svc.setDurationMinutes(30);
    svc.setActive(false);

    lenient()
        .when(salonServiceRepository.findByIdAndTenant_Id(200L, 1L))
        .thenReturn(Optional.of(svc));

    var res = service.activateService(1L, 200L);
    assertThat(res.active()).isTrue();
    assertThat(svc.isActive()).isTrue();
  }

  @Test
  void activateService_inactiveCategory_throwsBadRequest() {
    SalonService svc = new SalonService();
    svc.setId(201L);
    svc.setTenant(tenant);
    svc.setCategory(catBeard);
    svc.setName("Trim");
    svc.setPriceMinor(new BigDecimal("5000.00"));
    svc.setDurationMinutes(15);
    svc.setActive(false);

    lenient()
        .when(salonServiceRepository.findByIdAndTenant_Id(201L, 1L))
        .thenReturn(Optional.of(svc));

    assertThatThrownBy(() -> service.activateService(1L, 201L))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(
            ex ->
                assertThat(((ResponseStatusException) ex).getStatusCode())
                    .isEqualTo(HttpStatus.BAD_REQUEST));
  }

  @Test
  void activateService_notFound_throwsNotFound() {
    lenient()
        .when(salonServiceRepository.findByIdAndTenant_Id(999L, 1L))
        .thenReturn(Optional.empty());

    assertThatThrownBy(() -> service.activateService(1L, 999L))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(
            ex ->
                assertThat(((ResponseStatusException) ex).getStatusCode())
                    .isEqualTo(HttpStatus.NOT_FOUND));
  }

  @Test
  void activateCategory_inactiveCategory_setsActiveTrue() {
    var res = service.activateCategory(1L, 11L);
    assertThat(res.active()).isTrue();
    assertThat(catBeard.isActive()).isTrue();
  }

  @Test
  void activateCategory_notFound_throwsNotFound() {
    lenient()
        .when(serviceCategoryRepository.findByIdAndTenant_Id(999L, 1L))
        .thenReturn(Optional.empty());

    assertThatThrownBy(() -> service.activateCategory(1L, 999L))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(
            ex ->
                assertThat(((ResponseStatusException) ex).getStatusCode())
                    .isEqualTo(HttpStatus.NOT_FOUND));
  }
}
