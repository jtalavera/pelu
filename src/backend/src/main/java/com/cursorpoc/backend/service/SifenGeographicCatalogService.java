package com.cursorpoc.backend.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.text.Normalizer;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import org.springframework.stereotype.Service;

/**
 * SIFEN HU-02 AC-07: searchable in-memory index over the official DNIT geographic catalog (see
 * {@link SifenGeographicLocality}), loaded once from the bundled JSON resource — 6,766
 * department+city combinations, small enough to hold entirely in memory rather than needing a DB
 * table or an external call for every search keystroke.
 */
@Service
public class SifenGeographicCatalogService {

  private static final String CATALOG_RESOURCE = "/sifen/dnit-geographic-catalog.json";

  private final List<SifenGeographicLocality> localities;

  public SifenGeographicCatalogService() {
    this.localities = loadCatalog();
  }

  /**
   * Case/accent-insensitive substring match against either the city or department name — e.g.
   * "fernando" or "asuncion" (without tilde) both match "FERNANDO DE LA MORA". Capped at {@code
   * limit} results, department then city name order, so a broad query still returns something
   * useful instead of an overwhelming, unordered list.
   */
  public List<SifenGeographicLocality> search(String query, int limit) {
    String normalizedQuery = normalize(query);
    if (normalizedQuery.isBlank()) {
      return List.of();
    }
    return localities.stream()
        .filter(
            l ->
                normalize(l.cityName()).contains(normalizedQuery)
                    || normalize(l.departmentName()).contains(normalizedQuery))
        .sorted(
            Comparator.comparing(SifenGeographicLocality::departmentName)
                .thenComparing(SifenGeographicLocality::cityName))
        .limit(Math.max(0, limit))
        .toList();
  }

  private static String normalize(String value) {
    if (value == null) {
      return "";
    }
    String withoutAccents =
        Normalizer.normalize(value, Normalizer.Form.NFD).replaceAll("\\p{M}", "");
    return withoutAccents.toLowerCase(Locale.ROOT).trim();
  }

  private static List<SifenGeographicLocality> loadCatalog() {
    try (InputStream in =
        SifenGeographicCatalogService.class.getResourceAsStream(CATALOG_RESOURCE)) {
      if (in == null) {
        throw new IllegalStateException("Missing classpath resource: " + CATALOG_RESOURCE);
      }
      SifenGeographicLocality[] entries =
          new ObjectMapper().readValue(in, SifenGeographicLocality[].class);
      return List.of(entries);
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }
}
