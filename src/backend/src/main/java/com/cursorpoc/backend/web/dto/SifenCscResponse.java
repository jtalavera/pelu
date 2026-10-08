package com.cursorpoc.backend.web.dto;

import java.time.Instant;

/**
 * A CSC the tenant has loaded. Deliberately carries NO secret value: once saved, the CSC can never
 * be read back through the API — only replaced.
 */
public record SifenCscResponse(int idCsc, boolean active, Instant createdAt, Instant updatedAt) {}
