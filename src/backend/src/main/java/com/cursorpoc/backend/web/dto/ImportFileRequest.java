package com.cursorpoc.backend.web.dto;

/**
 * HU-51 (Épica E — Importación de datos vía Excel): candidate import file, sent as base64 JSON
 * (same convention {@code ValidateImportHeadersRequest} uses for HU-50's headers-only check), not
 * multipart.
 */
public record ImportFileRequest(String fileName, String fileBase64) {}
