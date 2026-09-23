package com.cursorpoc.backend.web.dto;

/** Minimal shape a tenant-creation form needs to render the tier dropdown (HU-37 AC-1). */
public record TierOptionResponse(Long id, String name) {}
