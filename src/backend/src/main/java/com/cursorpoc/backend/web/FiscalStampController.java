package com.cursorpoc.backend.web;

import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.service.FiscalStampService;
import com.cursorpoc.backend.web.dto.FiscalStampCreateRequest;
import com.cursorpoc.backend.web.dto.FiscalStampResponse;
import com.cursorpoc.backend.web.dto.FiscalStampUpdateRequest;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/fiscal-stamps")
public class FiscalStampController {

  private final FiscalStampService fiscalStampService;

  public FiscalStampController(FiscalStampService fiscalStampService) {
    this.fiscalStampService = fiscalStampService;
  }

  @GetMapping
  public List<FiscalStampResponse> list(@AuthenticationPrincipal FemmeUserPrincipal principal) {
    requirePrincipal(principal);
    return fiscalStampService.list(principal.getTenantId());
  }

  @PostMapping
  public FiscalStampResponse create(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @Valid @RequestBody FiscalStampCreateRequest request) {
    requirePrincipal(principal);
    return fiscalStampService.create(principal.getTenantId(), request);
  }

  @PutMapping("/{id}")
  public FiscalStampResponse update(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @PathVariable("id") long id,
      @Valid @RequestBody FiscalStampUpdateRequest request) {
    requirePrincipal(principal);
    return fiscalStampService.update(principal.getTenantId(), id, request);
  }

  @PostMapping("/{id}/activate")
  public FiscalStampResponse activate(
      @AuthenticationPrincipal FemmeUserPrincipal principal, @PathVariable("id") long id) {
    requirePrincipal(principal);
    return fiscalStampService.activate(principal.getTenantId(), id);
  }

  @PostMapping("/{id}/deactivate")
  public FiscalStampResponse deactivate(
      @AuthenticationPrincipal FemmeUserPrincipal principal, @PathVariable("id") long id) {
    requirePrincipal(principal);
    return fiscalStampService.deactivate(principal.getTenantId(), id);
  }

  private static void requirePrincipal(FemmeUserPrincipal principal) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Unauthorized");
    }
  }
}
