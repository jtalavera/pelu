package com.cursorpoc.backend.stock;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.config.StockProperties;
import com.cursorpoc.backend.domain.SalonService;
import com.cursorpoc.backend.domain.enums.ServiceKind;
import com.cursorpoc.backend.repository.SalonServiceRepository;
import com.cursorpoc.backend.stock.StockApiClient.StockResponse;
import com.cursorpoc.backend.stock.StockApiClient.StockUnavailableException;
import java.math.BigDecimal;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

/** HU-66: availability is informative only — every failure becomes {@code unavailable=true}. */
class StockAvailabilityServiceTest {

  private StockOutboxService outbox;
  private StockApiClient client;
  private SalonServiceRepository repository;
  private StockAvailabilityService service;

  @BeforeEach
  void setUp() {
    outbox = mock(StockOutboxService.class);
    client = mock(StockApiClient.class);
    repository = mock(SalonServiceRepository.class);
    StockProperties properties = new StockProperties();
    properties.setEnabled(true);
    properties.setBaseUrl("http://stock");
    properties.setClientSecret("s");
    when(outbox.stockEnabled(1L)).thenReturn(true);
    SalonService product = new SalonService();
    product.setId(5L);
    product.setKind(ServiceKind.PRODUCT);
    SalonService haircut = new SalonService();
    haircut.setId(6L);
    when(repository.findByTenantIdAndIdIn(eq(1L), any())).thenReturn(List.of(product, haircut));
    when(client.parse(anyString()))
        .thenAnswer(inv -> JsonMapper.builder().build().readTree((String) inv.getArgument(0)));
    service = new StockAvailabilityService(outbox, client, properties, repository);
  }

  @Test
  void returnsTheAvailableQuantityOfProductsOnly() {
    when(client.availability(eq(1L), eq("SERVICE"), eq(List.of("5")), anyString()))
        .thenReturn(
            new StockResponse(
                200,
                "{\"items\":[{\"externalId\":\"5\",\"mapped\":true,\"onHand\":3,"
                    + "\"available\":3,\"uom\":\"H87\",\"belowMinimum\":false}]}",
                null));

    StockAvailabilityService.AvailabilityResponse res = service.availability(1L, List.of(5L, 6L));

    assertThat(res.enabled()).isTrue();
    assertThat(res.unavailable()).isFalse();
    assertThat(res.items()).hasSize(1);
    assertThat(res.items().get(0).serviceId()).isEqualTo(5L);
    assertThat(res.items().get(0).available()).isEqualByComparingTo(new BigDecimal("3"));
  }

  @Test
  void stockDownIsUnavailableNotAnError() {
    when(client.availability(anyLong(), anyString(), any(), anyString()))
        .thenThrow(new StockUnavailableException("STOCK_UNREACHABLE", null));
    assertThat(service.availability(1L, List.of(5L)).unavailable()).isTrue();
  }

  @Test
  void stockErrorStatusIsUnavailable() {
    when(client.availability(anyLong(), anyString(), any(), anyString()))
        .thenReturn(new StockResponse(500, "{}", null));
    assertThat(service.availability(1L, List.of(5L)).unavailable()).isTrue();
  }

  @Test
  void tenantWithoutStockGetsNothingAndStockIsNotCalled() {
    when(outbox.stockEnabled(2L)).thenReturn(false);
    StockAvailabilityService.AvailabilityResponse res = service.availability(2L, List.of(5L));
    assertThat(res.enabled()).isFalse();
    assertThat(res.items()).isEmpty();
    verify(client, never()).availability(anyLong(), anyString(), any(), anyString());
  }
}
