package com.cursorpoc.backend.service;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.Client;
import com.cursorpoc.backend.domain.ClientBirthday;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.enums.ClientAcquisitionChannel;
import com.cursorpoc.backend.domain.enums.ClientIdentityDocumentType;
import com.cursorpoc.backend.domain.enums.ClientTaxpayerType;
import com.cursorpoc.backend.repository.ClientRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.util.ParaguayRucValidator;
import com.cursorpoc.backend.web.dto.ClientRequest;
import com.cursorpoc.backend.web.dto.ClientResponse;
import com.cursorpoc.backend.web.dto.PageResponse;
import java.time.LocalDate;
import java.util.List;
import java.util.Locale;
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
  private final FemmeTimeProperties timeProperties;

  static final int ACQUISITION_CHANNEL_OTHER_MAX = 100;

  public ClientService(
      ClientRepository clientRepository,
      TenantRepository tenantRepository,
      FemmeTimeProperties timeProperties) {
    this.timeProperties = timeProperties;
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

  /**
   * HU-68 AC12: the professional's view of the client list — id, name and active flag only, and the
   * query matches the name alone (never phone, email or RUC).
   */
  public static List<ClientResponse> nameOnlyForProfessional(List<ClientResponse> rows, String q) {
    String needle = normalizeQuery(q);
    String lowered = needle == null ? null : needle.toLowerCase(Locale.ROOT);
    return rows.stream()
        .filter(r -> lowered == null || r.fullName().toLowerCase(Locale.ROOT).contains(lowered))
        .map(
            r ->
                new ClientResponse(
                    r.id(),
                    r.fullName(),
                    null,
                    null,
                    null,
                    r.active(),
                    0,
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    null))
        .toList();
  }

  private static String normalizeQuery(String q) {
    return (q != null && !q.isBlank()) ? q.trim() : null;
  }

  @Transactional
  public ClientResponse create(long tenantId, ClientRequest request) {
    String fullName = request.fullName().trim().toUpperCase(Locale.ROOT);
    String phone = blankToNull(request.phone());
    String email = blankToNull(request.email());
    ClientIdentityDocumentType type = parseDocumentType(request.identityDocumentType());
    String[] rucAndDocument =
        applyDocumentTypeInvariant(
            type, blankToNull(request.ruc()), blankToNull(request.identityDocumentNumber()));
    String ruc = rucAndDocument[0];
    String identityDocumentNumber = rucAndDocument[1];

    if (isRucFormatCheckApplicable(type) && ruc != null && !ParaguayRucValidator.isValid(ruc)) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_RUC_FORMAT");
    }

    if (phone != null && phoneDuplicateExists(tenantId, phone, null)) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "CLIENT_PHONE_DUPLICATE");
    }
    if (ruc != null && clientRepository.findByTenantIdAndRuc(tenantId, ruc).isPresent()) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "CLIENT_RUC_DUPLICATE");
    }

    ClientAcquisitionChannel channel = parseAcquisitionChannel(request.acquisitionChannel());
    validateBirthday(request);
    String channelOther = acquisitionChannelOther(channel, request.acquisitionChannelOther());

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
    client.setIdentityDocumentNumber(identityDocumentNumber);
    client.setIdentityDocumentType(type);
    client.setTaxpayerType(parseTaxpayerType(request.taxpayerType()));
    client.setAddress(blankToNull(request.address()));
    client.setDepartmentCode(blankToNull(request.departmentCode()));
    client.setDepartmentName(blankToNull(request.departmentName()));
    client.setCityCode(blankToNull(request.cityCode()));
    client.setCityName(blankToNull(request.cityName()));
    applyProfileExtras(client, request, channel, channelOther);
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

    String fullName = request.fullName().trim().toUpperCase(Locale.ROOT);
    String phone = blankToNull(request.phone());
    String email = blankToNull(request.email());
    ClientIdentityDocumentType type = parseDocumentType(request.identityDocumentType());
    String[] rucAndDocument =
        applyDocumentTypeInvariant(
            type, blankToNull(request.ruc()), blankToNull(request.identityDocumentNumber()));
    String ruc = rucAndDocument[0];
    String identityDocumentNumber = rucAndDocument[1];

    if (isRucFormatCheckApplicable(type) && ruc != null && !ParaguayRucValidator.isValid(ruc)) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_RUC_FORMAT");
    }

    if (phone != null
        && !phone.equals(client.getPhone())
        && phoneDuplicateExists(tenantId, phone, client.getId())) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "CLIENT_PHONE_DUPLICATE");
    }
    if (ruc != null
        && !ruc.equals(client.getRuc())
        && clientRepository.findByTenantIdAndRuc(tenantId, ruc).isPresent()) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "CLIENT_RUC_DUPLICATE");
    }

    ClientAcquisitionChannel channel = parseAcquisitionChannel(request.acquisitionChannel());
    validateBirthday(request);
    String channelOther = acquisitionChannelOther(channel, request.acquisitionChannelOther());

    client.setFullName(fullName);
    client.setPhone(phone);
    client.setEmail(email);
    client.setRuc(ruc);
    client.setIdentityDocumentNumber(identityDocumentNumber);
    client.setIdentityDocumentType(type);
    client.setTaxpayerType(parseTaxpayerType(request.taxpayerType()));
    client.setAddress(blankToNull(request.address()));
    client.setDepartmentCode(blankToNull(request.departmentCode()));
    client.setDepartmentName(blankToNull(request.departmentName()));
    client.setCityCode(blankToNull(request.cityCode()));
    client.setCityName(blankToNull(request.cityName()));
    applyProfileExtras(client, request, channel, channelOther);
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

  private static ClientIdentityDocumentType parseDocumentType(String raw) {
    if (raw == null || raw.isBlank()) return null;
    try {
      return ClientIdentityDocumentType.valueOf(raw);
    } catch (IllegalArgumentException e) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_IDENTITY_DOCUMENT_TYPE");
    }
  }

  /** HU-69: day + month together, optional year, real date, not in the future. */
  private void validateBirthday(ClientRequest request) {
    LocalDate today = LocalDate.now(timeProperties.zoneId());
    if (!ClientBirthday.isValid(
        request.birthdayDay(), request.birthdayMonth(), request.birthdayYear(), today)) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_BIRTHDAY");
    }
  }

  private static ClientAcquisitionChannel parseAcquisitionChannel(String raw) {
    if (raw == null || raw.isBlank()) return null;
    try {
      return ClientAcquisitionChannel.valueOf(raw);
    } catch (IllegalArgumentException e) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_ACQUISITION_CHANNEL");
    }
  }

  /** The free-text detail only exists for OTRO, and is capped at 100 characters. */
  private static String acquisitionChannelOther(ClientAcquisitionChannel channel, String raw) {
    String other = channel == ClientAcquisitionChannel.OTRO ? blankToNull(raw) : null;
    if (other != null && other.length() > ACQUISITION_CHANNEL_OTHER_MAX) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "ACQUISITION_CHANNEL_OTHER_TOO_LONG");
    }
    return other;
  }

  private static void applyProfileExtras(
      Client client, ClientRequest request, ClientAcquisitionChannel channel, String channelOther) {
    client.setBirthdayDay(request.birthdayDay());
    client.setBirthdayMonth(request.birthdayMonth());
    client.setBirthdayYear(request.birthdayYear());
    client.setAcquisitionChannel(channel);
    client.setAcquisitionChannelOther(channelOther);
  }

  private static ClientTaxpayerType parseTaxpayerType(String raw) {
    if (raw == null || raw.isBlank()) return null;
    try {
      return ClientTaxpayerType.valueOf(raw);
    } catch (IllegalArgumentException e) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_TAXPAYER_TYPE");
    }
  }

  /**
   * Enforces that RUC and identity-document-number never coexist once a type is explicit: {@code
   * RUC} clears the document number, any other concrete type clears the RUC, and {@code INNOMINADO}
   * clears both. A {@code null} type (legacy caller not sending one) leaves both fields untouched,
   * preserving pre-existing behavior.
   */
  private static String[] applyDocumentTypeInvariant(
      ClientIdentityDocumentType type, String ruc, String identityDocumentNumber) {
    if (type == ClientIdentityDocumentType.RUC) {
      return new String[] {ruc, null};
    }
    if (type == ClientIdentityDocumentType.INNOMINADO) {
      return new String[] {null, null};
    }
    if (type != null) {
      return new String[] {null, identityDocumentNumber};
    }
    return new String[] {ruc, identityDocumentNumber};
  }

  private static boolean isRucFormatCheckApplicable(ClientIdentityDocumentType type) {
    return type == null || type == ClientIdentityDocumentType.RUC;
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
        c.getVisitCount(),
        c.getIdentityDocumentNumber(),
        c.getAddress(),
        c.getDepartmentCode(),
        c.getDepartmentName(),
        c.getCityCode(),
        c.getCityName(),
        c.getIdentityDocumentType() == null ? null : c.getIdentityDocumentType().name(),
        c.getTaxpayerType() == null ? null : c.getTaxpayerType().name(),
        c.getBirthdayDay(),
        c.getBirthdayMonth(),
        c.getBirthdayYear(),
        c.getAcquisitionChannel() == null ? null : c.getAcquisitionChannel().name(),
        c.getAcquisitionChannelOther());
  }
}
