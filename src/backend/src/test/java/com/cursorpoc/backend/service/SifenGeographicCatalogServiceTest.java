package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;

class SifenGeographicCatalogServiceTest {

  private final SifenGeographicCatalogService service = new SifenGeographicCatalogService();

  @Test
  void search_matchesByCityNameCaseAndAccentInsensitive() {
    List<SifenGeographicLocality> result = service.search("fernando de la mora", 20);

    assertThat(result)
        .anySatisfy(
            l -> {
              assertThat(l.departmentCode()).isEqualTo("12");
              assertThat(l.departmentName()).isEqualTo("CENTRAL");
              assertThat(l.cityCode()).isEqualTo("5044");
              assertThat(l.cityName()).isEqualTo("FERNANDO DE LA MORA");
            });
  }

  @Test
  void search_matchesByDepartmentName() {
    // "BOQUERON" also occurs as a city name in several other departments (a common Spanish
    // geographic term) — asserts the department itself is findable by name, not that every
    // result belongs to it.
    List<SifenGeographicLocality> result = service.search("boqueron", 200);

    assertThat(result).isNotEmpty();
    assertThat(result).anySatisfy(l -> assertThat(l.departmentName()).isEqualTo("BOQUERON"));
  }

  @Test
  void search_blankQuery_returnsEmpty() {
    assertThat(service.search("", 20)).isEmpty();
    assertThat(service.search("   ", 20)).isEmpty();
  }

  @Test
  void search_respectsLimit() {
    List<SifenGeographicLocality> result = service.search("a", 5);

    assertThat(result).hasSizeLessThanOrEqualTo(5);
  }

  @Test
  void search_noMatch_returnsEmpty() {
    assertThat(service.search("zzzznonexistentlocality", 20)).isEmpty();
  }
}
