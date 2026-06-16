package com.cursorpoc.backend.web;

import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.service.TourStateService;
import com.cursorpoc.backend.web.dto.TourStateResponse;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/me/tour-state")
public class TourStateController {

  private static final Logger log = LoggerFactory.getLogger(TourStateController.class);

  private final TourStateService tourStateService;

  public TourStateController(TourStateService tourStateService) {
    this.tourStateService = tourStateService;
  }

  @GetMapping
  public List<TourStateResponse> list(@AuthenticationPrincipal FemmeUserPrincipal principal) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    log.info("GET /api/me/tour-state userId={}", principal.getUserId());
    List<TourStateResponse> result = tourStateService.listSeenTours(principal.getUserId());
    log.info(
        "GET /api/me/tour-state userId={} status=200 count={}",
        principal.getUserId(),
        result.size());
    return result;
  }

  @PostMapping("/{key}")
  public void markSeen(
      @AuthenticationPrincipal FemmeUserPrincipal principal, @PathVariable("key") String key) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    log.info("POST /api/me/tour-state/{} userId={}", key, principal.getUserId());
    try {
      tourStateService.markTourSeen(principal.getUserId(), key);
      log.info("POST /api/me/tour-state/{} userId={} status=200", key, principal.getUserId());
    } catch (ResponseStatusException ex) {
      log.error(
          "POST /api/me/tour-state/{} userId={} status={}",
          key,
          principal.getUserId(),
          ex.getStatusCode().value());
      throw ex;
    }
  }
}
