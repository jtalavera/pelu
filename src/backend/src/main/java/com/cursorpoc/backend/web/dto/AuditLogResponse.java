package com.cursorpoc.backend.web.dto;

import java.time.Instant;

/** Issue #284: one audit-trail row as shown in "Auditoría" (never a request body). */
public record AuditLogResponse(
    long id,
    Long tenantId,
    String tenantName,
    String userEmail,
    String userRole,
    String httpMethod,
    String resource,
    String operation,
    String entityId,
    int statusCode,
    Instant createdAt) {}
