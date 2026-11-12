package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.domain.AppUser;
import com.cursorpoc.backend.domain.Client;
import com.cursorpoc.backend.domain.Professional;
import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.repository.AppUserRepository;
import com.cursorpoc.backend.repository.ClientRepository;
import com.cursorpoc.backend.repository.ProfessionalRepository;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.web.dto.ClientTechnicalSheetRequest;
import com.cursorpoc.backend.web.dto.ClientTechnicalSheetResponse;
import java.time.Instant;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.web.server.ResponseStatusException;

/** HU-68 — unit coverage of {@link ClientTechnicalSheetService}. */
@ExtendWith(MockitoExtension.class)
class ClientTechnicalSheetServiceTest {

  private static final long TENANT = 7L;
  private static final FemmeUserPrincipal ADMIN =
      new FemmeUserPrincipal(2L, TENANT, "admin@salon.test", UserRole.ADMIN, null);
  private static final FemmeUserPrincipal PRO =
      new FemmeUserPrincipal(3L, TENANT, "pro@salon.test", UserRole.PROFESSIONAL, 9L);

  @Mock private ClientRepository clientRepository;
  @Mock private AppUserRepository appUserRepository;
  @Mock private ProfessionalRepository professionalRepository;

  private ClientTechnicalSheetService service;
  private Client client;

  @BeforeEach
  void setUp() {
    service =
        new ClientTechnicalSheetService(
            clientRepository, appUserRepository, professionalRepository);
    client = new Client();
    client.setId(5L);
    client.setFullName("ANA");
    client.setActive(true);
    lenient()
        .when(clientRepository.findByIdAndTenant_Id(5L, TENANT))
        .thenReturn(Optional.of(client));
  }

  @Test
  void professionalEditStampsHerNameOnlyOnTheChangedField() {
    Professional pro = new Professional();
    pro.setFullName("LUCIA");
    when(professionalRepository.findByIdAndTenant_Id(9L, TENANT)).thenReturn(Optional.of(pro));
    Instant before = Instant.parse("2026-01-01T00:00:00Z");
    client.setColorFormula("7.1 + 20 vol");
    client.setColorFormulaUpdatedAt(before);
    client.setColorFormulaUpdatedBy("ADMIN");

    ClientTechnicalSheetResponse res =
        service.update(
            PRO, 5L, new ClientTechnicalSheetRequest("  Prefiere café  ", "7.1 + 20 vol"));

    assertThat(res.notes()).isEqualTo("Prefiere café");
    assertThat(res.notesUpdatedBy()).isEqualTo("LUCIA");
    assertThat(res.notesUpdatedAt()).isAfter(before);
    assertThat(res.colorFormulaUpdatedBy()).isEqualTo("ADMIN");
    assertThat(res.colorFormulaUpdatedAt()).isEqualTo(before);
  }

  @Test
  void adminEditUsesTheUserFullName() {
    AppUser user = new AppUser();
    user.setFullName("Isabel Zymanscki");
    when(appUserRepository.findById(2L)).thenReturn(Optional.of(user));
    ClientTechnicalSheetResponse res =
        service.update(ADMIN, 5L, new ClientTechnicalSheetRequest(null, "6.0"));
    assertThat(res.colorFormulaUpdatedBy()).isEqualTo("Isabel Zymanscki");
    assertThat(res.notesUpdatedBy()).isNull();
  }

  @Test
  void rejectsTextsOver2000Characters() {
    String tooLong = "x".repeat(2001);
    assertThatThrownBy(
            () -> service.update(ADMIN, 5L, new ClientTechnicalSheetRequest(tooLong, null)))
        .hasMessageContaining("CLIENT_NOTES_TOO_LONG");
    assertThatThrownBy(
            () -> service.update(ADMIN, 5L, new ClientTechnicalSheetRequest(null, tooLong)))
        .hasMessageContaining("CLIENT_COLOR_FORMULA_TOO_LONG");
  }

  @Test
  void inactiveClientIsReadOnly() {
    client.setActive(false);
    assertThat(service.get(TENANT, 5L).active()).isFalse();
    assertThatThrownBy(() -> service.update(ADMIN, 5L, new ClientTechnicalSheetRequest("a", null)))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("CLIENT_INACTIVE");
  }

  @Test
  void otherTenantClientIs404() {
    when(clientRepository.findByIdAndTenant_Id(5L, 99L)).thenReturn(Optional.empty());
    assertThatThrownBy(() -> service.get(99L, 5L)).hasMessageContaining("CLIENT_NOT_FOUND");
  }
}
