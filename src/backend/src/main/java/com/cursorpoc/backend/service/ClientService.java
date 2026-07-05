package com.cursorpoc.backend.service;

import com.cursorpoc.backend.domain.Client;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.repository.ClientRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.util.ParaguayRucValidator;
import com.cursorpoc.backend.web.dto.ClientRequest;
import com.cursorpoc.backend.web.dto.ClientResponse;
import com.cursorpoc.backend.web.dto.PageResponse;
import java.util.List;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class ClientService {

  private final ClientRepository clientRepository;
  private final TenantRepository tenantRepository;

  public ClientService(ClientRepository clientRepository, TenantRepository tenantRepository) {
    this.clientRepository = clientRepository;
    this.tenantRepository = tenantRepository;
  }

  public List<ClientResponse> search(
      long tenantId, String q, Boolean active, Boolean withRuc, Boolean isNew) {
    return clientRepository
        .findByTenantFilteredPaged(
            tenantId, normalizeQuery(q), active, withRuc, isNew, Pageable.unpaged())
        .getContent()
        .stream()
        .map(ClientService::toResponse)
        .toList();
  }

  @Transactional(readOnly = true)
  public PageResponse<ClientResponse> searchPaged(
      long tenantId, String q, Boolean active, Boolean withRuc, Boolean isNew, int page, int size) {
    PageRequest pageable = PageRequest.of(page, Math.max(1, Math.min(size, 200)));
    Page<Client> result =
        clientRepository.findByTenantFilteredPaged(
            tenantId, normalizeQuery(q), active, withRuc, isNew, pageable);
    List<ClientResponse> content =
        result.getContent().stream().map(ClientService::toResponse).toList();
    return new PageResponse<>(
        content,
        result.getNumber(),
        result.getSize(),
        result.getTotalElements(),
        result.getTotalPages());
  }

  private static String normalizeQuery(String q) {
    return (q != null && !q.isBlank()) ? q.trim() : null;
  }

  @Transactional
  public ClientResponse create(long tenantId, ClientRequest request) {
    String fullName = request.fullName().trim();
    String phone = blankToNull(request.phone());
    String email = blankToNull(request.email());
    String ruc = blankToNull(request.ruc());

    if (ruc != null && !ParaguayRucValidator.isValid(ruc)) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_RUC_FORMAT");
    }

    if (phone != null && phoneDuplicateExists(tenantId, phone, null)) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "CLIENT_PHONE_DUPLICATE");
    }
    if (email != null && clientRepository.findByTenantIdAndEmail(tenantId, email).isPresent()) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "CLIENT_EMAIL_DUPLICATE");
    }
    if (ruc != null && clientRepository.findByTenantIdAndRuc(tenantId, ruc).isPresent()) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "CLIENT_RUC_DUPLICATE");
    }

    Tenant tenant =
        tenantRepository
            .findById(tenantId)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "TENANT_NOT_FOUND"));

    Client client = new Client();
    client.setTenant(tenant);
    client.setFullName(fullName);
    client.setPhone(phone);
    client.setEmail(email);
    client.setRuc(ruc);
    client.setActive(true);
    client.setVisitCount(0);
    clientRepository.save(client);
    return toResponse(client);
  }

  public ClientResponse getById(long tenantId, long clientId) {
    Client client =
        clientRepository
            .findByIdAndTenant_Id(clientId, tenantId)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "CLIENT_NOT_FOUND"));
    return toResponse(client);
  }

  @Transactional
  public ClientResponse update(long tenantId, long clientId, ClientRequest request) {
    Client client =
        clientRepository
            .findByIdAndTenant_Id(clientId, tenantId)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "CLIENT_NOT_FOUND"));

    String fullName = request.fullName().trim();
    String phone = blankToNull(request.phone());
    String email = blankToNull(request.email());
    String ruc = blankToNull(request.ruc());

    if (ruc != null && !ParaguayRucValidator.isValid(ruc)) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_RUC_FORMAT");
    }

    if (phone != null
        && !phone.equals(client.getPhone())
        && phoneDuplicateExists(tenantId, phone, client.getId())) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "CLIENT_PHONE_DUPLICATE");
    }
    if (email != null
        && !email.equalsIgnoreCase(client.getEmail())
        && clientRepository.findByTenantIdAndEmail(tenantId, email).isPresent()) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "CLIENT_EMAIL_DUPLICATE");
    }
    if (ruc != null
        && !ruc.equals(client.getRuc())
        && clientRepository.findByTenantIdAndRuc(tenantId, ruc).isPresent()) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "CLIENT_RUC_DUPLICATE");
    }

    client.setFullName(fullName);
    client.setPhone(phone);
    client.setEmail(email);
    client.setRuc(ruc);
    clientRepository.save(client);
    return toResponse(client);
  }

  @Transactional
  public ClientResponse deactivate(long tenantId, long clientId) {
    Client client =
        clientRepository
            .findByIdAndTenant_Id(clientId, tenantId)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "CLIENT_NOT_FOUND"));
    client.setActive(false);
    clientRepository.save(client);
    return toResponse(client);
  }

  @Transactional
  public ClientResponse activate(long tenantId, long clientId) {
    Client client =
        clientRepository
            .findByIdAndTenant_Id(clientId, tenantId)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "CLIENT_NOT_FOUND"));
    client.setActive(true);
    clientRepository.save(client);
    return toResponse(client);
  }

  private static String blankToNull(String value) {
    if (value == null || value.isBlank()) return null;
    return value.trim();
  }

  /**
   * Phone duplicate check compares digits only: clients may be created with formatted numbers (e.g.
   * "(0981) 123-456") or raw digits (e.g. via API integrations), and both represent the same phone
   * number.
   */
  private boolean phoneDuplicateExists(long tenantId, String phone, Long excludeClientId) {
    String targetDigits = digitsOnly(phone);
    if (targetDigits == null) return false;
    return clientRepository.findByTenant_Id(tenantId).stream()
        .filter(c -> excludeClientId == null || !c.getId().equals(excludeClientId))
        .anyMatch(c -> targetDigits.equals(digitsOnly(c.getPhone())));
  }

  private static String digitsOnly(String value) {
    if (value == null) return null;
    String digits = value.replaceAll("\\D+", "");
    return digits.isEmpty() ? null : digits;
  }

  static ClientResponse toResponse(Client c) {
    return new ClientResponse(
        c.getId(),
        c.getFullName(),
        c.getPhone(),
        c.getEmail(),
        c.getRuc(),
        c.isActive(),
        c.getVisitCount());
  }
}
