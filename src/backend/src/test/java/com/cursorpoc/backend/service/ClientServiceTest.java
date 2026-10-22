package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.Client;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.enums.ServiceRecordStatus;
import com.cursorpoc.backend.repository.ClientRepository;
import com.cursorpoc.backend.repository.ServiceRecordRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.web.dto.ClientRequest;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.Spy;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

@ExtendWith(MockitoExtension.class)
class ClientServiceTest {

  @Mock private ClientRepository clientRepository;
  @Mock private TenantRepository tenantRepository;
  @Mock private ServiceRecordRepository serviceRecordRepository;
  @Spy private FemmeTimeProperties timeProperties = new FemmeTimeProperties();

  @InjectMocks private ClientService clientService;

  private Tenant tenant;
  private final AtomicLong ids = new AtomicLong(1);

  @BeforeEach
  void setUp() {
    tenant = new Tenant();
    tenant.setId(1L);
    tenant.setName("Demo");

    lenient().when(tenantRepository.findById(1L)).thenReturn(Optional.of(tenant));

    lenient()
        .when(clientRepository.save(any(Client.class)))
        .thenAnswer(
            inv -> {
              Client c = inv.getArgument(0);
              if (c.getId() == null) {
                c.setId(ids.getAndIncrement());
              }
              return c;
            });
  }

  @Test
  void create_withNameOnly_succeeds() {
    lenient()
        .when(clientRepository.findByTenantIdAndRuc(any(), any()))
        .thenReturn(Optional.empty());

    var response = clientService.create(1L, new ClientRequest("Ana García", null, null, null));

    assertThat(response.fullName()).isEqualTo("ANA GARCÍA");
    assertThat(response.active()).isTrue();
    assertThat(response.visitCount()).isZero();
    assertThat(response.phone()).isNull();
    assertThat(response.email()).isNull();
    assertThat(response.ruc()).isNull();
  }

  @Test
  void create_trimsFullName() {
    lenient()
        .when(clientRepository.findByTenantIdAndRuc(any(), any()))
        .thenReturn(Optional.empty());

    var response = clientService.create(1L, new ClientRequest("  Ana  ", null, null, null));

    assertThat(response.fullName()).isEqualTo("ANA");
  }

  @Test
  void create_withValidRuc_succeeds() {
    lenient()
        .when(clientRepository.findByTenantIdAndRuc(any(), any()))
        .thenReturn(Optional.empty());

    var response =
        clientService.create(1L, new ClientRequest("Ana García", null, null, "80000005-6"));

    assertThat(response.ruc()).isEqualTo("80000005-6");
  }

  @Test
  void create_withInvalidRuc_throwsBadRequest() {
    assertThatThrownBy(
            () -> clientService.create(1L, new ClientRequest("Ana", null, null, "12345")))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(
            ex ->
                assertThat(((ResponseStatusException) ex).getStatusCode())
                    .isEqualTo(HttpStatus.BAD_REQUEST));
  }

  @Test
  void create_withCedulaParaguayaType_skipsRucFormatCheck() {

    var response =
        clientService.create(
            1L,
            new ClientRequest(
                "Ana García",
                null,
                null,
                null,
                "4123456",
                null,
                null,
                null,
                null,
                null,
                "CEDULA_PARAGUAYA"));

    assertThat(response.identityDocumentType()).isEqualTo("CEDULA_PARAGUAYA");
    assertThat(response.identityDocumentNumber()).isEqualTo("4123456");
    assertThat(response.ruc()).isNull();
  }

  /** SIFEN D205/iTiContRec: a client explicitly marked Persona Jurídica persists that value. */
  @Test
  void create_withRucAndPersonaJuridica_persistsTaxpayerType() {
    lenient()
        .when(clientRepository.findByTenantIdAndRuc(any(), any()))
        .thenReturn(Optional.empty());

    var response =
        clientService.create(
            1L,
            new ClientRequest(
                "Empresa Demo",
                null,
                null,
                "80000005-6",
                null,
                null,
                null,
                null,
                null,
                null,
                "RUC",
                "PERSONA_JURIDICA"));

    assertThat(response.taxpayerType()).isEqualTo("PERSONA_JURIDICA");
  }

  @Test
  void create_withInvalidTaxpayerType_throwsBadRequest() {
    assertThatThrownBy(
            () ->
                clientService.create(
                    1L,
                    new ClientRequest(
                        "Ana",
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
                        "NOT_A_REAL_TYPE")))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(
            ex ->
                assertThat(((ResponseStatusException) ex).getStatusCode())
                    .isEqualTo(HttpStatus.BAD_REQUEST));
  }

  @Test
  void create_withExplicitRucType_stillValidatesFormat() {
    assertThatThrownBy(
            () ->
                clientService.create(
                    1L,
                    new ClientRequest(
                        "Ana", null, null, "12345", null, null, null, null, null, null, "RUC")))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(
            ex ->
                assertThat(((ResponseStatusException) ex).getStatusCode())
                    .isEqualTo(HttpStatus.BAD_REQUEST));
  }

  @Test
  void create_withNonRucTypeAndRucAlsoSent_clearsRucKeepsDocumentNumber() {

    var response =
        clientService.create(
            1L,
            new ClientRequest(
                "Ana",
                null,
                null,
                "80000005-6",
                "AB123456",
                null,
                null,
                null,
                null,
                null,
                "PASAPORTE"));

    assertThat(response.identityDocumentType()).isEqualTo("PASAPORTE");
    assertThat(response.identityDocumentNumber()).isEqualTo("AB123456");
    assertThat(response.ruc()).isNull();
  }

  @Test
  void create_withInnominadoType_clearsBothRucAndDocumentNumber() {
    var response =
        clientService.create(
            1L,
            new ClientRequest(
                "Ana",
                null,
                null,
                "80000005-6",
                "AB123456",
                null,
                null,
                null,
                null,
                null,
                "INNOMINADO"));

    assertThat(response.identityDocumentType()).isEqualTo("INNOMINADO");
    assertThat(response.identityDocumentNumber()).isNull();
    assertThat(response.ruc()).isNull();
  }

  @Test
  void create_withInvalidIdentityDocumentType_throwsBadRequest() {
    assertThatThrownBy(
            () ->
                clientService.create(
                    1L,
                    new ClientRequest(
                        "Ana", null, null, null, null, null, null, null, null, null, "NOT_A_TYPE")))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(
            ex ->
                assertThat(((ResponseStatusException) ex).getStatusCode())
                    .isEqualTo(HttpStatus.BAD_REQUEST));
  }

  @Test
  void create_duplicatePhone_throwsConflict() {
    Client existing = buildClient(2L, "Other", "0981000001", null, null);
    lenient().when(clientRepository.findByTenant_Id(1L)).thenReturn(List.of(existing));

    assertThatThrownBy(
            () -> clientService.create(1L, new ClientRequest("New", "0981000001", null, null)))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(
            ex ->
                assertThat(((ResponseStatusException) ex).getStatusCode())
                    .isEqualTo(HttpStatus.CONFLICT));
  }

  @Test
  void create_duplicatePhone_differentFormatting_throwsConflict() {
    Client existing = buildClient(2L, "Other", "0981000001", null, null);
    lenient().when(clientRepository.findByTenant_Id(1L)).thenReturn(List.of(existing));

    assertThatThrownBy(
            () -> clientService.create(1L, new ClientRequest("New", "(0981) 000-001", null, null)))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(
            ex ->
                assertThat(((ResponseStatusException) ex).getStatusCode())
                    .isEqualTo(HttpStatus.CONFLICT));
  }

  @Test
  void create_sameEmailAsAnotherClient_succeeds() {
    lenient()
        .when(clientRepository.findByTenantIdAndRuc(any(), any()))
        .thenReturn(Optional.empty());

    var response = clientService.create(1L, new ClientRequest("New", null, "a@b.com", null));

    assertThat(response.email()).isEqualTo("a@b.com");
    verify(clientRepository).save(any(Client.class));
  }

  @Test
  void update_sameEmailAsAnotherClient_succeeds() {
    Client c = buildClient(5L, "Ana", null, "old@b.com", null);
    lenient().when(clientRepository.findByIdAndTenant_Id(5L, 1L)).thenReturn(Optional.of(c));
    lenient().when(clientRepository.findByTenant_Id(1L)).thenReturn(List.of(c));
    lenient()
        .when(clientRepository.findByTenantIdAndRuc(any(), any()))
        .thenReturn(Optional.empty());

    var response =
        clientService.update(1L, 5L, new ClientRequest("Ana", null, "taken@b.com", null));

    assertThat(response.email()).isEqualTo("taken@b.com");
  }

  @Test
  void create_duplicateRuc_throwsConflict() {
    Client existing = buildClient(2L, "Other", null, null, "80000005-6");
    lenient()
        .when(clientRepository.findByTenantIdAndRuc(1L, "80000005-6"))
        .thenReturn(Optional.of(existing));

    assertThatThrownBy(
            () -> clientService.create(1L, new ClientRequest("New", null, null, "80000005-6")))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(
            ex ->
                assertThat(((ResponseStatusException) ex).getStatusCode())
                    .isEqualTo(HttpStatus.CONFLICT));
  }

  @Test
  void create_emptyPhoneAndEmail_treatedAsNull_noUniquenessCheck() {
    // blank strings → null → uniqueness not checked
    lenient()
        .when(clientRepository.findByTenantIdAndRuc(any(), any()))
        .thenReturn(Optional.empty());

    var response = clientService.create(1L, new ClientRequest("Maria", "  ", " ", " "));
    assertThat(response.phone()).isNull();
    assertThat(response.email()).isNull();
    assertThat(response.ruc()).isNull();
  }

  @Test
  void search_delegatesToRepository_unpaged() {
    Client c = buildClient(10L, "Ana García", "0981000001", null, null);
    when(clientRepository.findByTenantFilteredPaged(
            eq(1L), eq("ana"), eq(null), eq(null), eq(null), eq(Pageable.unpaged())))
        .thenReturn(new PageImpl<>(List.of(c)));

    var results = clientService.search(1L, "ana", null, null, null);
    assertThat(results).hasSize(1);
    assertThat(results.get(0).fullName()).isEqualTo("Ana García");
  }

  @Test
  void search_blankQuery_normalizedToNull() {
    when(clientRepository.findByTenantFilteredPaged(
            eq(1L), eq(null), eq(null), eq(null), eq(null), eq(Pageable.unpaged())))
        .thenReturn(new PageImpl<>(List.of()));

    var results = clientService.search(1L, "   ", null, null, null);
    assertThat(results).isEmpty();
  }

  @Test
  void searchPaged_trimsQuery_andPassesFilters() {
    Client c = buildClient(10L, "Ana García", "0981000001", null, "80000005-6");
    when(clientRepository.findByTenantFilteredPaged(
            eq(1L), eq("ana"), eq(true), eq(true), eq(null), any(PageRequest.class)))
        .thenReturn(new PageImpl<>(List.of(c), PageRequest.of(0, 10), 1));

    var response = clientService.searchPaged(1L, "  ana ", true, true, null, 0, 10);

    assertThat(response.content()).hasSize(1);
    assertThat(response.content().get(0).fullName()).isEqualTo("Ana García");
    assertThat(response.page()).isEqualTo(0);
    assertThat(response.size()).isEqualTo(10);
    assertThat(response.totalElements()).isEqualTo(1);
    assertThat(response.totalPages()).isEqualTo(1);
  }

  @Test
  void searchPaged_clampsSizeTo200() {
    when(clientRepository.findByTenantFilteredPaged(
            eq(1L), eq(null), eq(null), eq(null), eq(null), any(PageRequest.class)))
        .thenReturn(new PageImpl<>(List.of(), PageRequest.of(0, 200), 0));

    clientService.searchPaged(1L, null, null, null, null, 0, 5000);

    verify(clientRepository)
        .findByTenantFilteredPaged(
            eq(1L), eq(null), eq(null), eq(null), eq(null), eq(PageRequest.of(0, 200)));
  }

  @Test
  void searchPaged_clampsSizeToAtLeastOne() {
    when(clientRepository.findByTenantFilteredPaged(
            eq(1L), eq(null), eq(null), eq(null), eq(null), any(PageRequest.class)))
        .thenReturn(new PageImpl<>(List.of(), PageRequest.of(0, 1), 0));

    clientService.searchPaged(1L, null, null, null, null, 0, 0);

    verify(clientRepository)
        .findByTenantFilteredPaged(
            eq(1L), eq(null), eq(null), eq(null), eq(null), eq(PageRequest.of(0, 1)));
  }

  @Test
  void getById_existingClient_returnsResponse() {
    Client c = buildClient(5L, "Ana", "0981000001", "ana@b.com", null);
    lenient().when(clientRepository.findByIdAndTenant_Id(5L, 1L)).thenReturn(Optional.of(c));

    var response = clientService.getById(1L, 5L);
    assertThat(response.id()).isEqualTo(5L);
    assertThat(response.fullName()).isEqualTo("Ana");
  }

  @Test
  void getById_notFound_throwsNotFound() {
    lenient().when(clientRepository.findByIdAndTenant_Id(99L, 1L)).thenReturn(Optional.empty());

    assertThatThrownBy(() -> clientService.getById(1L, 99L))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(
            ex ->
                assertThat(((ResponseStatusException) ex).getStatusCode())
                    .isEqualTo(HttpStatus.NOT_FOUND));
  }

  @Test
  void update_changesNameAndPhone() {
    Client c = buildClient(5L, "Old Name", "0981000000", null, null);
    lenient().when(clientRepository.findByIdAndTenant_Id(5L, 1L)).thenReturn(Optional.of(c));
    lenient().when(clientRepository.findByTenant_Id(1L)).thenReturn(List.of(c));
    lenient()
        .when(clientRepository.findByTenantIdAndRuc(any(), any()))
        .thenReturn(Optional.empty());

    var response =
        clientService.update(1L, 5L, new ClientRequest("New Name", "0981999999", null, null));
    assertThat(response.fullName()).isEqualTo("NEW NAME");
    assertThat(response.phone()).isEqualTo("0981999999");
  }

  @Test
  void update_samePhone_doesNotThrowDuplicate() {
    Client c = buildClient(5L, "Ana", "0981000001", null, null);
    lenient().when(clientRepository.findByIdAndTenant_Id(5L, 1L)).thenReturn(Optional.of(c));
    lenient()
        .when(clientRepository.findByTenantIdAndRuc(any(), any()))
        .thenReturn(Optional.empty());

    // same phone → no conflict
    var response = clientService.update(1L, 5L, new ClientRequest("Ana", "0981000001", null, null));
    assertThat(response.phone()).isEqualTo("0981000001");
  }

  @Test
  void update_duplicatePhone_throwsConflict() {
    Client c = buildClient(5L, "Ana", "0981000001", null, null);
    Client other = buildClient(6L, "Other", "0981999999", null, null);
    lenient().when(clientRepository.findByIdAndTenant_Id(5L, 1L)).thenReturn(Optional.of(c));
    lenient().when(clientRepository.findByTenant_Id(1L)).thenReturn(List.of(c, other));

    assertThatThrownBy(
            () -> clientService.update(1L, 5L, new ClientRequest("Ana", "0981999999", null, null)))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(
            ex ->
                assertThat(((ResponseStatusException) ex).getStatusCode())
                    .isEqualTo(HttpStatus.CONFLICT));
  }

  @Test
  void update_notFound_throwsNotFound() {
    lenient().when(clientRepository.findByIdAndTenant_Id(99L, 1L)).thenReturn(Optional.empty());

    assertThatThrownBy(
            () -> clientService.update(1L, 99L, new ClientRequest("Name", null, null, null)))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(
            ex ->
                assertThat(((ResponseStatusException) ex).getStatusCode())
                    .isEqualTo(HttpStatus.NOT_FOUND));
  }

  @Test
  void update_invalidRuc_throwsBadRequest() {
    Client c = buildClient(5L, "Ana", null, null, null);
    lenient().when(clientRepository.findByIdAndTenant_Id(5L, 1L)).thenReturn(Optional.of(c));

    assertThatThrownBy(
            () -> clientService.update(1L, 5L, new ClientRequest("Ana", null, null, "BADRUC")))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(
            ex ->
                assertThat(((ResponseStatusException) ex).getStatusCode())
                    .isEqualTo(HttpStatus.BAD_REQUEST));
  }

  @Test
  void deactivate_existingClient_setsInactive() {
    Client c = buildClient(5L, "Ana", null, null, null);
    c.setActive(true);
    lenient().when(clientRepository.findByIdAndTenant_Id(5L, 1L)).thenReturn(Optional.of(c));

    var response = clientService.deactivate(1L, 5L);
    assertThat(response.active()).isFalse();
  }

  @Test
  void deactivate_notFound_throwsNotFound() {
    lenient().when(clientRepository.findByIdAndTenant_Id(99L, 1L)).thenReturn(Optional.empty());

    assertThatThrownBy(() -> clientService.deactivate(1L, 99L))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(
            ex ->
                assertThat(((ResponseStatusException) ex).getStatusCode())
                    .isEqualTo(HttpStatus.NOT_FOUND));
  }

  @Test
  void activate_existingInactiveClient_setsActive() {
    Client c = buildClient(5L, "Ana", null, null, null);
    c.setActive(false);
    lenient().when(clientRepository.findByIdAndTenant_Id(5L, 1L)).thenReturn(Optional.of(c));

    var response = clientService.activate(1L, 5L);
    assertThat(response.active()).isTrue();
  }

  @Test
  void activate_notFound_throwsNotFound() {
    lenient().when(clientRepository.findByIdAndTenant_Id(99L, 1L)).thenReturn(Optional.empty());

    assertThatThrownBy(() -> clientService.activate(1L, 99L))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(
            ex ->
                assertThat(((ResponseStatusException) ex).getStatusCode())
                    .isEqualTo(HttpStatus.NOT_FOUND));
  }

  private Client buildClient(Long id, String fullName, String phone, String email, String ruc) {
    Client c = new Client();
    c.setId(id);
    c.setTenant(tenant);
    c.setFullName(fullName);
    c.setPhone(phone);
    c.setEmail(email);
    c.setRuc(ruc);
    c.setActive(true);
    c.setVisitCount(0);
    return c;
  }

  private static ClientRequest withExtras(
      Integer day, Integer month, Integer year, String channel, String other) {
    return new ClientRequest(
        "Ana", null, null, null, null, null, null, null, null, null, null, null, day, month, year,
        channel, other);
  }

  @Test
  void create_storesBirthdayAndAcquisitionChannel() {
    var response = clientService.create(1L, withExtras(29, 2, null, "OTRO", "  Feria  "));
    assertThat(response.birthdayDay()).isEqualTo(29);
    assertThat(response.birthdayMonth()).isEqualTo(2);
    assertThat(response.birthdayYear()).isNull();
    assertThat(response.acquisitionChannel()).isEqualTo("OTRO");
    assertThat(response.acquisitionChannelOther()).isEqualTo("Feria");
  }

  @Test
  void create_dropsTheDetailUnlessChannelIsOtro() {
    var response = clientService.create(1L, withExtras(null, null, null, "INSTAGRAM", "ignored"));
    assertThat(response.acquisitionChannelOther()).isNull();
  }

  @Test
  void create_rejectsInvalidBirthdayAndChannel() {
    assertThatThrownBy(() -> clientService.create(1L, withExtras(31, 4, null, null, null)))
        .hasMessageContaining("INVALID_BIRTHDAY");
    assertThatThrownBy(() -> clientService.create(1L, withExtras(15, null, null, null, null)))
        .hasMessageContaining("INVALID_BIRTHDAY");
    assertThatThrownBy(() -> clientService.create(1L, withExtras(1, 1, 3000, null, null)))
        .hasMessageContaining("INVALID_BIRTHDAY");
    assertThatThrownBy(() -> clientService.create(1L, withExtras(null, null, null, "TV", null)))
        .hasMessageContaining("INVALID_ACQUISITION_CHANNEL");
    assertThatThrownBy(
            () -> clientService.create(1L, withExtras(null, null, null, "OTRO", "x".repeat(101))))
        .hasMessageContaining("ACQUISITION_CHANNEL_OTHER_TOO_LONG");
  }

  @Test
  void visitsAreCountedFromClosedServiceRecords() {
    Client c = new Client();
    c.setId(7L);
    c.setFullName("ANA");
    c.setActive(true);
    c.setVisitCount(0); // legacy column, never maintained
    when(clientRepository.findByIdAndTenant_Id(7L, 1L)).thenReturn(Optional.of(c));
    Instant last = Instant.parse("2026-10-20T15:00:00Z");
    when(serviceRecordRepository.countByClientIds(1L, ServiceRecordStatus.CLOSED, List.of(7L)))
        .thenReturn(List.<Object[]>of(new Object[] {7L, 3L, last}));

    var res = clientService.getById(1L, 7L);
    assertThat(res.visitCount()).isEqualTo(3);
    assertThat(res.lastVisitAt()).isEqualTo("2026-10-20T15:00:00Z");
  }

  @Test
  void searchCountsVisitsForEveryClientInOneQuery() {
    Client a = new Client();
    a.setId(1L);
    a.setFullName("ANA");
    Client b = new Client();
    b.setId(2L);
    b.setFullName("BEA");
    when(clientRepository.findByTenantFilteredPaged(
            eq(1L), any(), any(), any(), any(), any(Pageable.class)))
        .thenReturn(new PageImpl<>(List.of(a, b)));
    when(serviceRecordRepository.countByClientIds(
            eq(1L), eq(ServiceRecordStatus.CLOSED), eq(List.of(1L, 2L))))
        .thenReturn(
            List.<Object[]>of(new Object[] {1L, 5L, Instant.parse("2026-10-01T12:00:00Z")}));

    var rows = clientService.search(1L, null, null, null, null);

    assertThat(rows).extracting(r -> r.visitCount()).containsExactly(5, 0);
    assertThat(rows.get(1).lastVisitAt()).isNull();
  }

  @Test
  void newThisMonthFiltersByCreationSinceTheFirstOfTheMonth() {
    when(clientRepository.findByTenantFilteredPaged(
            eq(1L), any(), any(), any(), any(), any(Pageable.class)))
        .thenReturn(new PageImpl<>(List.of()));

    clientService.search(1L, null, null, null, true);
    clientService.search(1L, null, null, null, null);

    var captor = org.mockito.ArgumentCaptor.forClass(Instant.class);
    org.mockito.Mockito.verify(clientRepository, org.mockito.Mockito.times(2))
        .findByTenantFilteredPaged(
            eq(1L), any(), any(), any(), captor.capture(), any(Pageable.class));
    var zone = java.time.ZoneId.of("America/Asuncion");
    Instant firstOfMonth =
        java.time.LocalDate.now(zone).withDayOfMonth(1).atStartOfDay(zone).toInstant();
    assertThat(captor.getAllValues()).containsExactly(firstOfMonth, null);
  }
}
