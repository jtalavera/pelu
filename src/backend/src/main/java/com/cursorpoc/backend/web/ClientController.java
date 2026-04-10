package com.cursorpoc.backend.web;

import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.service.ClientService;
import com.cursorpoc.backend.web.dto.ClientRequest;
import com.cursorpoc.backend.web.dto.ClientResponse;
import jakarta.validation.Valid;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/clients")
public class ClientController {

  private static final Logger log = LoggerFactory.getLogger(ClientController.class);

  private final ClientService clientService;

  public ClientController(ClientService clientService) {
    this.clientService = clientService;
  }

  @GetMapping
  public List<ClientResponse> search(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @RequestParam(name = "q", required = false) String q) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    log.info("GET /api/clients tenantId={}", principal.getTenantId());
    List<ClientResponse> result = clientService.search(principal.getTenantId(), q);
    log.info("GET /api/clients tenantId={} status=200", principal.getTenantId());
    return result;
  }

  @GetMapping("/{id}")
  public ClientResponse getById(
      @AuthenticationPrincipal FemmeUserPrincipal principal, @PathVariable("id") long id) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    log.info("GET /api/clients/{} tenantId={}", id, principal.getTenantId());
    ClientResponse result = clientService.getById(principal.getTenantId(), id);
    log.info("GET /api/clients/{} tenantId={} status=200", id, principal.getTenantId());
    return result;
  }

  @PostMapping
  public ClientResponse create(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @Valid @RequestBody ClientRequest request) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    log.info("POST /api/clients tenantId={}", principal.getTenantId());
    try {
      ClientResponse result = clientService.create(principal.getTenantId(), request);
      log.info("POST /api/clients tenantId={} status=200", principal.getTenantId());
      return result;
    } catch (ResponseStatusException ex) {
      log.error(
          "POST /api/clients tenantId={} status={}", principal.getTenantId(), ex.getStatusCode());
      throw ex;
    }
  }

  @PutMapping("/{id}")
  public ClientResponse update(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @PathVariable("id") long id,
      @Valid @RequestBody ClientRequest request) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    log.info("PUT /api/clients/{} tenantId={}", id, principal.getTenantId());
    try {
      ClientResponse result = clientService.update(principal.getTenantId(), id, request);
      log.info("PUT /api/clients/{} tenantId={} status=200", id, principal.getTenantId());
      return result;
    } catch (ResponseStatusException ex) {
      log.error(
          "PUT /api/clients/{} tenantId={} status={}",
          id,
          principal.getTenantId(),
          ex.getStatusCode());
      throw ex;
    }
  }

  @PostMapping("/{id}/deactivate")
  public ClientResponse deactivate(
      @AuthenticationPrincipal FemmeUserPrincipal principal, @PathVariable("id") long id) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    log.info("POST /api/clients/{}/deactivate tenantId={}", id, principal.getTenantId());
    try {
      ClientResponse result = clientService.deactivate(principal.getTenantId(), id);
      log.info(
          "POST /api/clients/{}/deactivate tenantId={} status=200", id, principal.getTenantId());
      return result;
    } catch (ResponseStatusException ex) {
      log.error(
          "POST /api/clients/{}/deactivate tenantId={} status={}",
          id,
          principal.getTenantId(),
          ex.getStatusCode());
      throw ex;
    }
  }
}
