package com.cursorpoc.backend.web.dto;

import java.util.List;

/**
 * HU-50 AC-1/AC-7: one entity's full standard import template — documented in a place visible to
 * the Platform Admin at import time (the {@code /platform/import} screen), not only in the HU-50
 * spec file.
 */
public record ImportColumnTemplateResponse(String entity, List<ImportColumnResponse> columns) {}
