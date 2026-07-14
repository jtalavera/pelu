package com.cursorpoc.backend.web;

import com.cursorpoc.backend.service.SeedResetService;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

// Disabled as a production hotfix alongside FemmeDataInitializer's startup runner: this endpoint
// is unauthenticated (permitAll in SecurityConfig) and bulk-deletes tenant id=1 data, which is
// unsafe now that real usage exists on that tenant. Left in place pending a proper refactor;
// re-enable by setting femme.data-init.enabled=true.
@RestController
@RequestMapping("/api/admin/seed")
@ConditionalOnProperty(name = "femme.data-init.enabled", havingValue = "true")
public class SeedResetController {

  private static final Logger log = LoggerFactory.getLogger(SeedResetController.class);

  private final SeedResetService seedResetService;

  public SeedResetController(SeedResetService seedResetService) {
    this.seedResetService = seedResetService;
  }

  @PostMapping("/reset")
  public Map<String, String> reset() {
    log.info("POST /api/admin/seed/reset — request received");
    seedResetService.resetDemoTenant();
    log.info("POST /api/admin/seed/reset — response 200 OK");
    return Map.of("status", "ok", "message", "Seed data reset successfully");
  }
}
