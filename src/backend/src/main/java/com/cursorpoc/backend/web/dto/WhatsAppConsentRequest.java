package com.cursorpoc.backend.web.dto;

import jakarta.validation.constraints.NotNull;

/** HU-WAP-03: turns a client's WhatsApp consent on or off. */
public record WhatsAppConsentRequest(@NotNull Boolean optIn) {}
