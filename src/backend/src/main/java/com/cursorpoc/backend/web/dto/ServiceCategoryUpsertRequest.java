package com.cursorpoc.backend.web.dto;

import jakarta.validation.constraints.NotBlank;

/** {@code kind}: SERVICE (default when null) or PRODUCT; it cannot be changed after creation. */
public record ServiceCategoryUpsertRequest(@NotBlank String name, String accentKey, String kind) {

  public ServiceCategoryUpsertRequest(String name, String accentKey) {
    this(name, accentKey, null);
  }
}
