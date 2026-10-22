package com.cursorpoc.backend.service;

import com.cursorpoc.backend.domain.Client;
import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.repository.AppUserRepository;
import com.cursorpoc.backend.repository.ClientRepository;
import com.cursorpoc.backend.repository.ProfessionalRepository;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.web.dto.ClientTechnicalSheetRequest;
import com.cursorpoc.backend.web.dto.ClientTechnicalSheetResponse;
import java.time.Instant;
import java.util.Objects;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * HU-68: reads and edits a client's technical sheet (notes + color formula). Reachable by admins
 * and professionals (including PIN sessions) — see {@code ProfessionalAccessPolicy}.
 */
@Service
public class ClientTechnicalSheetService {

  static final int MAX_LENGTH = 2000;

  private final ClientRepository clientRepository;
  private final AppUserRepository appUserRepository;
  private final ProfessionalRepository professionalRepository;

  public ClientTechnicalSheetService(
      ClientRepository clientRepository,
      AppUserRepository appUserRepository,
      ProfessionalRepository professionalRepository) {
    this.clientRepository = clientRepository;
    this.appUserRepository = appUserRepository;
    this.professionalRepository = professionalRepository;
  }

  @Transactional(readOnly = true)
  public ClientTechnicalSheetResponse get(long tenantId, long clientId) {
    return toResponse(requireClient(tenantId, clientId));
  }

  @Transactional
  public ClientTechnicalSheetResponse update(
      FemmeUserPrincipal principal, long clientId, ClientTechnicalSheetRequest request) {
    Client client = requireClient(principal.getTenantId(), clientId);
    String notes = blankToNull(request.notes());
    String colorFormula = blankToNull(request.colorFormula());
    if (notes != null && notes.length() > MAX_LENGTH) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "CLIENT_NOTES_TOO_LONG");
    }
    if (colorFormula != null && colorFormula.length() > MAX_LENGTH) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "CLIENT_COLOR_FORMULA_TOO_LONG");
    }
    if (!client.isActive()) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "CLIENT_INACTIVE");
    }

    // "Edited by" only moves for the field that actually changed.
    Instant now = Instant.now();
    String editor = null;
    if (!Objects.equals(notes, client.getNotes())) {
      editor = editorName(principal);
      client.setNotes(notes);
      client.setNotesUpdatedAt(now);
      client.setNotesUpdatedBy(editor);
    }
    if (!Objects.equals(colorFormula, client.getColorFormula())) {
      editor = editor != null ? editor : editorName(principal);
      client.setColorFormula(colorFormula);
      client.setColorFormulaUpdatedAt(now);
      client.setColorFormulaUpdatedBy(editor);
    }
    return toResponse(client);
  }

  private Client requireClient(long tenantId, long clientId) {
    return clientRepository
        .findByIdAndTenant_Id(clientId, tenantId)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "CLIENT_NOT_FOUND"));
  }

  /** The professional's name for professional sessions, otherwise the user's full name. */
  private String editorName(FemmeUserPrincipal principal) {
    if (principal.getRole() == UserRole.PROFESSIONAL && principal.getProfessionalId() != null) {
      var professional =
          professionalRepository.findByIdAndTenant_Id(
              principal.getProfessionalId(), principal.getTenantId());
      if (professional.isPresent()) {
        return professional.get().getFullName();
      }
    }
    return appUserRepository
        .findById(principal.getUserId())
        .map(u -> u.getFullName() != null ? u.getFullName() : u.getEmail())
        .orElse(principal.getUsername());
  }

  private static String blankToNull(String value) {
    if (value == null || value.isBlank()) return null;
    return value.strip();
  }

  private static ClientTechnicalSheetResponse toResponse(Client c) {
    return new ClientTechnicalSheetResponse(
        c.getId(),
        c.getFullName(),
        c.isActive(),
        c.getNotes(),
        c.getNotesUpdatedAt(),
        c.getNotesUpdatedBy(),
        c.getColorFormula(),
        c.getColorFormulaUpdatedAt(),
        c.getColorFormulaUpdatedBy());
  }
}
