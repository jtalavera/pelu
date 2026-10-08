package com.cursorpoc.backend.stock;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import com.cursorpoc.backend.config.StockProperties;
import com.cursorpoc.backend.domain.SalonService;
import com.cursorpoc.backend.domain.ServiceCategory;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.enums.ServiceKind;
import com.cursorpoc.backend.repository.SalonServiceRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * Issue #284: a product migrates to Stock together with the category assigned in Pelu. Stock keeps
 * its own category table, so the contract is the category NAME ({@code category}), matched/created
 * on Stock's side.
 */
class StockPayloadsTest {

  private final StockPayloads payloads =
      new StockPayloads(
          mock(TenantRepository.class), mock(SalonServiceRepository.class), new StockProperties());

  private static SalonService product(String categoryName) {
    Tenant tenant = new Tenant();
    tenant.setId(1L);
    ServiceCategory category = new ServiceCategory();
    category.setId(12L);
    category.setTenant(tenant);
    category.setName(categoryName);
    category.setKind(ServiceKind.PRODUCT);
    SalonService s = new SalonService();
    s.setId(77L);
    s.setTenant(tenant);
    s.setName("Shampoo");
    s.setCategory(category);
    s.setKind(ServiceKind.PRODUCT);
    s.setActive(true);
    return s;
  }

  @Test
  void catalogItem_carriesThePeluCategoryName() {
    Map<String, Object> item = payloads.catalogItem(product("Insumos de peluquería"));

    assertThat(item)
        .containsEntry("externalType", "SERVICE")
        .containsEntry("externalId", "77")
        .containsEntry("name", "Shampoo")
        .containsEntry("category", "Insumos de peluquería")
        .containsEntry("active", true);
  }

  @Test
  void catalogItem_followsTheCategoryWhenItIsRenamed() {
    SalonService s = product("Insumos");
    s.getCategory().setName("Insumos de uso interno");

    assertThat(payloads.catalogItem(s)).containsEntry("category", "Insumos de uso interno");
  }
}
