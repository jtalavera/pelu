package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.lenient;

import com.cursorpoc.backend.domain.Client;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.repository.ClientRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.web.dto.ClientRequest;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

@ExtendWith(MockitoExtension.class)
class ClientServiceTest {

  @Mock private ClientRepository clientRepository;
  @Mock private TenantRepository tenantRepository;

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
        .when(clientRepository.findByTenantIdAndPhone(any(), any()))
        .thenReturn(Optional.empty());
    lenient()
        .when(clientRepository.findByTenantIdAndEmail(any(), any()))
        .thenReturn(Optional.empty());
    lenient()
        .when(clientRepository.findByTenantIdAndRuc(any(), any()))
        .thenReturn(Optional.empty());

    var response = clientService.create(1L, new ClientRequest("Ana García", null, null, null));

    assertThat(response.fullName()).isEqualTo("Ana García");
    assertThat(response.active()).isTrue();
    assertThat(response.visitCount()).isZero();
    assertThat(response.phone()).isNull();
    assertThat(response.email()).isNull();
    assertThat(response.ruc()).isNull();
  }

  @Test
  void create_trimsFullName() {
    lenient()
        .when(clientRepository.findByTenantIdAndPhone(any(), any()))
        .thenReturn(Optional.empty());
    lenient()
        .when(clientRepository.findByTenantIdAndEmail(any(), any()))
        .thenReturn(Optional.empty());
    lenient()
        .when(clientRepository.findByTenantIdAndRuc(any(), any()))
        .thenReturn(Optional.empty());

    var response = clientService.create(1L, new ClientRequest("  Ana  ", null, null, null));

    assertThat(response.fullName()).isEqualTo("Ana");
  }

  @Test
  void create_withValidRuc_succeeds() {
    lenient()
        .when(clientRepository.findByTenantIdAndPhone(any(), any()))
        .thenReturn(Optional.empty());
    lenient()
        .when(clientRepository.findByTenantIdAndEmail(any(), any()))
        .thenReturn(Optional.empty());
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
  void create_duplicatePhone_throwsConflict() {
    Client existing = buildClient(2L, "Other", "0981000001", null, null);
    lenient()
        .when(clientRepository.findByTenantIdAndPhone(1L, "0981000001"))
        .thenReturn(Optional.of(existing));

    assertThatThrownBy(
            () -> clientService.create(1L, new ClientRequest("New", "0981000001", null, null)))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(
            ex ->
                assertThat(((ResponseStatusException) ex).getStatusCode())
                    .isEqualTo(HttpStatus.CONFLICT));
  }

  @Test
  void create_duplicateEmail_throwsConflict() {
    Client existing = buildClient(2L, "Other", null, "a@b.com", null);
    lenient()
        .when(clientRepository.findByTenantIdAndPhone(any(), any()))
        .thenReturn(Optional.empty());
    lenient()
        .when(clientRepository.findByTenantIdAndEmail(1L, "a@b.com"))
        .thenReturn(Optional.of(existing));

    assertThatThrownBy(
            () -> clientService.create(1L, new ClientRequest("New", null, "a@b.com", null)))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(
            ex ->
                assertThat(((ResponseStatusException) ex).getStatusCode())
                    .isEqualTo(HttpStatus.CONFLICT));
  }

  @Test
  void create_duplicateRuc_throwsConflict() {
    Client existing = buildClient(2L, "Other", null, null, "80000005-6");
    lenient()
        .when(clientRepository.findByTenantIdAndPhone(any(), any()))
        .thenReturn(Optional.empty());
    lenient()
        .when(clientRepository.findByTenantIdAndEmail(any(), any()))
        .thenReturn(Optional.empty());
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
        .when(clientRepository.findByTenantIdAndPhone(any(), any()))
        .thenReturn(Optional.empty());
    lenient()
        .when(clientRepository.findByTenantIdAndEmail(any(), any()))
        .thenReturn(Optional.empty());
    lenient()
        .when(clientRepository.findByTenantIdAndRuc(any(), any()))
        .thenReturn(Optional.empty());

    var response = clientService.create(1L, new ClientRequest("Maria", "  ", " ", " "));
    assertThat(response.phone()).isNull();
    assertThat(response.email()).isNull();
    assertThat(response.ruc()).isNull();
  }

  @Test
  void search_delegatesToRepository() {
    Client c = buildClient(10L, "Ana García", "0981000001", null, null);
    lenient().when(clientRepository.search(1L, "ana", "ana", "ana")).thenReturn(List.of(c));

    var results = clientService.search(1L, "ana");
    assertThat(results).hasSize(1);
    assertThat(results.get(0).fullName()).isEqualTo("Ana García");
  }

  @Test
  void search_emptyQuery_passesEmptyString() {
    lenient().when(clientRepository.search(1L, "", null, null)).thenReturn(List.of());

    var results = clientService.search(1L, null);
    assertThat(results).isEmpty();
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
    lenient()
        .when(clientRepository.findByTenantIdAndPhone(1L, "0981999999"))
        .thenReturn(Optional.empty());
    lenient()
        .when(clientRepository.findByTenantIdAndEmail(any(), any()))
        .thenReturn(Optional.empty());
    lenient()
        .when(clientRepository.findByTenantIdAndRuc(any(), any()))
        .thenReturn(Optional.empty());

    var response =
        clientService.update(1L, 5L, new ClientRequest("New Name", "0981999999", null, null));
    assertThat(response.fullName()).isEqualTo("New Name");
    assertThat(response.phone()).isEqualTo("0981999999");
  }

  @Test
  void update_samePhone_doesNotThrowDuplicate() {
    Client c = buildClient(5L, "Ana", "0981000001", null, null);
    lenient().when(clientRepository.findByIdAndTenant_Id(5L, 1L)).thenReturn(Optional.of(c));
    lenient()
        .when(clientRepository.findByTenantIdAndPhone(any(), any()))
        .thenReturn(Optional.of(c));
    lenient()
        .when(clientRepository.findByTenantIdAndEmail(any(), any()))
        .thenReturn(Optional.empty());
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
    lenient()
        .when(clientRepository.findByTenantIdAndPhone(1L, "0981999999"))
        .thenReturn(Optional.of(other));

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
}
