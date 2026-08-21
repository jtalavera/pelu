package com.cursorpoc.backend.web.dto;

/** HU-45 AC-1: {@code name} is required and must be unique; {@code description} is optional. */
public record TierCreateRequest(String name, String description) {}
