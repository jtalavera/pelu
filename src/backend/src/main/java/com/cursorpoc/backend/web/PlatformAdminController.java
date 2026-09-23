package com.cursorpoc.backend.web;

import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.web.dto.PlatformMeResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * HU-34: the first explicit {@code /api/platform/**} route. Its only purpose in this story is to
 * prove the plumbing end to end (AC-3: a tenant-less PLATFORM_ADMIN token is accepted here; AC-5:
 * this is the *only* kind of route such a token can reach — never a tenant-scoped one). Real
 * platform features (tenant CRUD, tier/flag management, etc.) land in later HUs under this same
 * prefix.
 */
@RestController
@RequestMapping("/api/platform")
public class PlatformAdminController {

  private static final Logger log = LoggerFactory.getLogger(PlatformAdminController.class);

  @GetMapping("/me")
  public PlatformMeResponse me(@AuthenticationPrincipal FemmeUserPrincipal principal) {
    log.info(
        "GET /api/platform/me role={}", principal == null ? "null" : principal.getRole().name());
    requirePlatformAdmin(principal);
    log.info("GET /api/platform/me userId={} status=200", principal.getUserId());
    return new PlatformMeResponse(
        principal.getUserId(), principal.getUsername(), principal.getRole().name());
  }

  private static void requirePlatformAdmin(FemmeUserPrincipal principal) {
    if (principal == null) {
      log.error("GET /api/platform/me status=401 - no principal");
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    if (principal.getRole() != UserRole.PLATFORM_ADMIN) {
      log.error(
          "GET /api/platform/me status=403 - role={} is not PLATFORM_ADMIN",
          principal.getRole().name());
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "FORBIDDEN");
    }
  }
}
