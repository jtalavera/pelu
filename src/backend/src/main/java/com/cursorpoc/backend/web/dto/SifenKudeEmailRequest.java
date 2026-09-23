package com.cursorpoc.backend.web.dto;

/**
 * SIFEN HU-08 AC-17. {@code email} is optional — when blank/omitted, the client's own email on file
 * is used instead (see {@code SifenKudeEmailService#resolveRecipientEmail}).
 */
public record SifenKudeEmailRequest(String email) {}
