package com.cursorpoc.backend.web.dto;

/**
 * HU-50 AC-5/AC-6: candidate file to check, sent as base64 JSON (same convention as {@code
 * SifenCertificatesPage}'s upload — see {@code SifenCertificateUploadRequest}), not multipart.
 */
public record ValidateImportHeadersRequest(String fileName, String fileBase64) {}
