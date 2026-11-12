package com.cursorpoc.backend.web.dto;

/** Body of {@code POST /api/propinas/late/{id}/void}; the reason is mandatory (audit). */
public record VoidLateTipRequest(String reason) {}
