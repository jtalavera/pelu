package com.cursorpoc.backend.web;

import java.util.Map;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping(path = "/health", produces = MediaType.APPLICATION_JSON_VALUE)
public class HealthController {

  @GetMapping
  public Map<String, String> health() {
    return Map.of("status", "UP");
  }
}
