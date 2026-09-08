package com.cursorpoc.backend.web.dto;

/** HU-45 AC-2: editing a tier's name and/or description. */
public record TierUpdateRequest(String name, String description) {}
