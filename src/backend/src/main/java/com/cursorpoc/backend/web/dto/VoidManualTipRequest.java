package com.cursorpoc.backend.web.dto;

/** Body of {@code POST /api/propinas/manual/{id}/void}; the reason is mandatory (audit). */
public record VoidManualTipRequest(String reason) {}
