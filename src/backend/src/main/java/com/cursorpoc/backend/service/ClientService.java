package com.cursorpoc.backend.service;

import com.cursorpoc.backend.domain.Client;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.repository.ClientRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.util.ParaguayRucValidator;
import com.cursorpoc.backend.web.dto.ClientRequest;
import com.cursorpoc.backend.web.dto.ClientResponse;
import java.util.List;
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

  public List<ClientResponse> search(long tenantId, String q) {
    String normalized = q == null ? "" : q.trim();
    String phone = normalized.isEmpty() ? null : normalized;
    String ruc = normalized.isEmpty() ? null : normalized;
    return clientRepository.search(tenantId, normalized, phone, ruc).stream()
        .map(ClientService::toResponse)
        .toList();
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

    if (phone != null && clientRepository.findByTenantIdAndPhone(tenantId, phone).isPresent()) {
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
        && clientRepository.findByTenantIdAndPhone(tenantId, phone).isPresent()) {
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

  private static String blankToNull(String value) {
    if (value == null || value.isBlank()) return null;
    return value.trim();
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
