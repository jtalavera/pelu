package com.cursorpoc.backend.web;

import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.service.ClientService;
import com.cursorpoc.backend.service.ClientSummaryService;
import com.cursorpoc.backend.service.ClientTechnicalSheetService;
import com.cursorpoc.backend.web.dto.ClientRequest;
import com.cursorpoc.backend.web.dto.ClientResponse;
import com.cursorpoc.backend.web.dto.ClientSummaryResponse;
import com.cursorpoc.backend.web.dto.ClientTechnicalSheetRequest;
import com.cursorpoc.backend.web.dto.ClientTechnicalSheetResponse;
import com.cursorpoc.backend.web.dto.PageResponse;
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
  private final ClientSummaryService clientSummaryService;
  private final ClientTechnicalSheetService clientTechnicalSheetService;

  public ClientController(
      ClientService clientService,
      ClientSummaryService clientSummaryService,
      ClientTechnicalSheetService clientTechnicalSheetService) {
    this.clientService = clientService;
    this.clientSummaryService = clientSummaryService;
    this.clientTechnicalSheetService = clientTechnicalSheetService;
  }

  @GetMapping
  public List<ClientResponse> search(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @RequestParam(name = "q", required = false) String q,
      @RequestParam(name = "active", required = false) Boolean active,
      @RequestParam(name = "withRuc", required = false) Boolean withRuc,
      @RequestParam(name = "isNew", required = false) Boolean isNew) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    log.info("GET /api/clients tenantId={}", principal.getTenantId());
    List<ClientResponse> result =
        clientService.search(principal.getTenantId(), q, active, withRuc, isNew);
    if (principal.getRole() == UserRole.PROFESSIONAL) {
      // HU-68 AC12: professionals search by name only and never see personal data.
      result = ClientService.nameOnlyForProfessional(result, q);
    }
    log.info("GET /api/clients tenantId={} status=200", principal.getTenantId());
    return result;
  }

  @GetMapping("/page")
  public PageResponse<ClientResponse> searchPaged(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @RequestParam(name = "q", required = false) String q,
      @RequestParam(name = "active", required = false) Boolean active,
      @RequestParam(name = "withRuc", required = false) Boolean withRuc,
      @RequestParam(name = "isNew", required = false) Boolean isNew,
      @RequestParam(name = "page", defaultValue = "0") int page,
      @RequestParam(name = "size", defaultValue = "10") int size) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    log.info(
        "GET /api/clients/page tenantId={} page={} size={}", principal.getTenantId(), page, size);
    try {
      PageResponse<ClientResponse> response =
          clientService.searchPaged(principal.getTenantId(), q, active, withRuc, isNew, page, size);
      log.info(
          "GET /api/clients/page tenantId={} status=200 total={}",
          principal.getTenantId(),
          response.totalElements());
      return response;
    } catch (ResponseStatusException ex) {
      log.error(
          "GET /api/clients/page tenantId={} status={}",
          principal.getTenantId(),
          ex.getStatusCode().value());
      throw ex;
    }
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

  /** HU-67: profile summary (usual professional, last services/products, spend). Admin only. */
  @GetMapping("/{id}/summary")
  public ClientSummaryResponse getSummary(
      @AuthenticationPrincipal FemmeUserPrincipal principal, @PathVariable("id") long id) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    log.info("GET /api/clients/{}/summary tenantId={}", id, principal.getTenantId());
    try {
      ClientSummaryResponse result = clientSummaryService.getSummary(principal.getTenantId(), id);
      log.info("GET /api/clients/{}/summary tenantId={} status=200", id, principal.getTenantId());
      return result;
    } catch (ResponseStatusException ex) {
      log.error(
          "GET /api/clients/{}/summary tenantId={} status={}",
          id,
          principal.getTenantId(),
          ex.getStatusCode().value());
      throw ex;
    }
  }

  /** HU-68: technical sheet (notes + color formula) — admins and professionals. */
  @GetMapping("/{id}/technical-sheet")
  public ClientTechnicalSheetResponse getTechnicalSheet(
      @AuthenticationPrincipal FemmeUserPrincipal principal, @PathVariable("id") long id) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    log.info("GET /api/clients/{}/technical-sheet tenantId={}", id, principal.getTenantId());
    try {
      ClientTechnicalSheetResponse result =
          clientTechnicalSheetService.get(principal.getTenantId(), id);
      log.info(
          "GET /api/clients/{}/technical-sheet tenantId={} status=200",
          id,
          principal.getTenantId());
      return result;
    } catch (ResponseStatusException ex) {
      log.error(
          "GET /api/clients/{}/technical-sheet tenantId={} status={}",
          id,
          principal.getTenantId(),
          ex.getStatusCode().value());
      throw ex;
    }
  }

  @PutMapping("/{id}/technical-sheet")
  public ClientTechnicalSheetResponse updateTechnicalSheet(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @PathVariable("id") long id,
      @RequestBody ClientTechnicalSheetRequest request) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    log.info("PUT /api/clients/{}/technical-sheet tenantId={}", id, principal.getTenantId());
    try {
      ClientTechnicalSheetResponse result =
          clientTechnicalSheetService.update(principal, id, request);
      log.info(
          "PUT /api/clients/{}/technical-sheet tenantId={} status=200",
          id,
          principal.getTenantId());
      return result;
    } catch (ResponseStatusException ex) {
      log.error(
          "PUT /api/clients/{}/technical-sheet tenantId={} status={}",
          id,
          principal.getTenantId(),
          ex.getStatusCode().value());
      throw ex;
    }
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

  @PostMapping("/{id}/activate")
  public ClientResponse activate(
      @AuthenticationPrincipal FemmeUserPrincipal principal, @PathVariable("id") long id) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    log.info("POST /api/clients/{}/activate tenantId={}", id, principal.getTenantId());
    try {
      ClientResponse result = clientService.activate(principal.getTenantId(), id);
      log.info("POST /api/clients/{}/activate tenantId={} status=200", id, principal.getTenantId());
      return result;
    } catch (ResponseStatusException ex) {
      log.error(
          "POST /api/clients/{}/activate tenantId={} status={}",
          id,
          principal.getTenantId(),
          ex.getStatusCode());
      throw ex;
    }
  }
}
