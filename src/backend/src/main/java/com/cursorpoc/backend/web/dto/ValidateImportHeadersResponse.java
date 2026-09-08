package com.cursorpoc.backend.web.dto;

import java.util.List;

/**
 * HU-50 AC-5/AC-6: header/file validation outcome. {@code errorCode} ({@code SCREAMING_SNAKE_CASE},
 * translated via {@code femme.apiErrors.*}) is set only for whole-file problems (wrong extension,
 * corrupt/unreadable file); a missing-required-column rejection is reported through {@code
 * missingRequiredColumns} instead, listing exactly which ones to add.
 */
public record ValidateImportHeadersResponse(
    boolean valid, String errorCode, List<String> missingRequiredColumns) {}
