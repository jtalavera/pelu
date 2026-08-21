package com.cursorpoc.backend.web.dto;

public record TenantResponse(
    Long id, String name, String domain, Long tierId, String tierName, String status) {}
