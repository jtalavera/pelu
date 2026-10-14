package com.cursorpoc.backend.web.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;

public record ServiceUpsertRequest(
    @NotBlank String name,
    @NotNull Long categoryId,
    Long taxId,
    @NotNull @Min(0) BigDecimal priceMinor,
    @Min(1) int durationMinutes,
    // HU-59: SERVICE (default when null) or PRODUCT; optional product code.
    String kind,
    @Size(max = 64) String sku) {

  /** Pre-HU-59 shape: a plain service with no SKU. */
  public ServiceUpsertRequest(
      String name, Long categoryId, Long taxId, BigDecimal priceMinor, int durationMinutes) {
    this(name, categoryId, taxId, priceMinor, durationMinutes, null, null);
  }
}
