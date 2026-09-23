package com.cursorpoc.backend.web.dto;

/**
 * HU-51 AC-3/AC-4/AC-5: outcome of one data row. {@code errorCode} ({@code SCREAMING_SNAKE_CASE},
 * translated via {@code femme.apiErrors.*}) is set only when {@code imported} is {@code false}.
 */
public record ImportRowResultResponse(
    int rowNumber, boolean imported, String errorCode, String name) {}
