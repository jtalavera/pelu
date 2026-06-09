package com.cursorpoc.backend.web;

import com.cursorpoc.backend.service.SeedResetService;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/seed")
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
