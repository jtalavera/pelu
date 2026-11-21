package com.cursorpoc.backend.assistant;

import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.security.FemmeUserPrincipal;

/**
 * Who is talking to the assistant. Captured from the authenticated principal BEFORE the request is
 * handed to the worker thread, and the only source of tenant/role for every tool: the model never
 * supplies either.
 */
public record AssistantContext(
    long tenantId,
    long userId,
    UserRole role,
    Long professionalId,
    String currentPage,
    Long conversationId) {

  /** Without a conversation: enough for the read-only tools. */
  public AssistantContext(
      long tenantId, long userId, UserRole role, Long professionalId, String currentPage) {
    this(tenantId, userId, role, professionalId, currentPage, null);
  }

  public static AssistantContext from(
      FemmeUserPrincipal principal, String currentPage, Long conversationId) {
    return new AssistantContext(
        principal.getTenantId(),
        principal.getUserId(),
        principal.getRole(),
        principal.getProfessionalId(),
        sanitizePage(currentPage),
        conversationId);
  }

  /**
   * Short route name ("hoy", "calendar"…) — free text from the client must not reach the prompt.
   */
  static String sanitizePage(String page) {
    if (page == null || !page.matches("[a-z0-9_-]{1,40}")) {
      return "";
    }
    return page;
  }

  public boolean isProfessional() {
    return role == UserRole.PROFESSIONAL;
  }

  public boolean isAdmin() {
    return role == UserRole.ADMIN;
  }
}
