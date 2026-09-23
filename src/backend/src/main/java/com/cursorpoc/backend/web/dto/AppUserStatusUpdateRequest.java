package com.cursorpoc.backend.web.dto;

/**
 * HU-43 AC-1/AC-3: {@code enabled=false} deactivates the user (blocks login, invalidates any open
 * session); {@code enabled=true} reactivates them.
 */
public record AppUserStatusUpdateRequest(Boolean enabled) {}
