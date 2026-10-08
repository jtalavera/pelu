package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import com.cursorpoc.backend.config.SifenConnectionProperties;
import com.cursorpoc.backend.config.SifenQrProperties;
import com.cursorpoc.backend.domain.SifenCsc;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.repository.SifenCscRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.web.dto.SifenCscResponse;
import com.cursorpoc.backend.web.dto.SifenCscSaveRequest;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/**
 * Per-tenant CSC: each salon loads its own Código de Seguridad del Contribuyente (the DNIT issues
 * one per taxpayer). Exercises {@link SifenCscService} against the real local-file secret store, so
 * the "value never in the row" and tenant-prefix guarantees are covered end to end.
 */
@ExtendWith(MockitoExtension.class)
class SifenCscServiceTest {

  private static final String CSC_A = "AAAA1111BBBB2222CCCC3333DDDD4444";
  private static final String CSC_B = "ZZZZ9999YYYY8888XXXX7777WWWW6666";

  @Mock private SifenCscRepository repository;
  @Mock private TenantRepository tenantRepository;

  @TempDir Path tempDir;

  private LocalFileSifenCscSecretStore store;
  private SifenConnectionProperties connectionProperties;
  private SifenCscService service;

  /** In-memory stand-in for the sifen_csc table. */
  private final List<SifenCsc> rows = new ArrayList<>();

  @BeforeEach
  void setUp() {
    store = new LocalFileSifenCscSecretStore(tempDir.toString());
    connectionProperties = new SifenConnectionProperties();
    service =
        new SifenCscService(
            repository, store, tenantRepository, new SifenQrProperties(), connectionProperties);

    lenient()
        .when(tenantRepository.findById(any()))
        .thenAnswer(
            inv -> {
              Tenant t = new Tenant();
              t.setId(inv.getArgument(0));
              return Optional.of(t);
            });
    lenient()
        .when(repository.findByTenant_IdOrderByIdCscAsc(any()))
        .thenAnswer(
            inv ->
                rows.stream()
                    .filter(r -> r.getTenant().getId().equals(inv.getArgument(0)))
                    .sorted((a, b) -> Integer.compare(a.getIdCsc(), b.getIdCsc()))
                    .toList());
    lenient()
        .when(repository.findByTenant_IdAndIdCsc(any(), org.mockito.ArgumentMatchers.anyInt()))
        .thenAnswer(
            inv ->
                rows.stream()
                    .filter(
                        r ->
                            r.getTenant().getId().equals(inv.getArgument(0))
                                && r.getIdCsc() == (int) inv.getArgument(1))
                    .findFirst());
    lenient()
        .when(repository.findByTenant_IdAndActiveTrue(any()))
        .thenAnswer(
            inv ->
                rows.stream()
                    .filter(r -> r.getTenant().getId().equals(inv.getArgument(0)) && r.isActive())
                    .findFirst());
    lenient()
        .when(repository.save(any(SifenCsc.class)))
        .thenAnswer(
            inv -> {
              SifenCsc row = inv.getArgument(0);
              if (!rows.contains(row)) rows.add(row);
              return row;
            });
    lenient()
        .when(repository.saveAndFlush(any(SifenCsc.class)))
        .thenAnswer(inv -> inv.getArgument(0));
    lenient().when(repository.saveAllAndFlush(anyList())).thenAnswer(inv -> inv.getArgument(0));
  }

  private SifenCscResponse save(long tenantId, int idCsc, String value) {
    return service.save(tenantId, 99L, new SifenCscSaveRequest(idCsc, value));
  }

  @Test
  void firstCsc_becomesActiveAutomatically_andLaterOnesDoNot() {
    SifenCscResponse first = save(1L, 3, CSC_A);
    SifenCscResponse second = save(1L, 4, CSC_B);

    assertThat(first.active()).isTrue();
    assertThat(second.active()).isFalse();
    assertThat(service.resolveActive(1L)).isEqualTo(new SifenActiveCsc(3, CSC_A));
  }

  @Test
  void theValueIsOnlyInTheSecretStore_neverInTheRowOrTheResponse() {
    SifenCscResponse response = save(1L, 3, CSC_A);

    SifenCsc row = rows.get(0);
    assertThat(row.getSecretName()).startsWith("sifen-csc-t1-").doesNotContain(CSC_A);
    assertThat(row.getSecretVersion()).doesNotContain(CSC_A);
    assertThat(response.toString()).doesNotContain(CSC_A);
    assertThat(new SifenCscSaveRequest(3, CSC_A).toString()).doesNotContain(CSC_A);
  }

  @Test
  void savingAnExistingIdCsc_replacesItsValue_keepingItsActiveState() {
    save(1L, 3, CSC_A);
    save(1L, 4, CSC_B);

    SifenCscResponse replaced = save(1L, 3, "NEWC0000000000000000000000000001");

    assertThat(rows).hasSize(2);
    assertThat(replaced.active()).isTrue();
    assertThat(service.resolveActive(1L).secret()).isEqualTo("NEWC0000000000000000000000000001");
  }

  @Test
  void activate_switchesTheCscUsedToSignTheQr() {
    save(1L, 3, CSC_A);
    save(1L, 4, CSC_B);

    SifenCscResponse activated = service.activate(1L, 99L, 4);

    assertThat(activated.active()).isTrue();
    assertThat(rows)
        .filteredOn(SifenCsc::isActive)
        .singleElement()
        .satisfies(r -> assertThat(r.getIdCsc()).isEqualTo(4));
    assertThat(service.resolveActive(1L)).isEqualTo(new SifenActiveCsc(4, CSC_B));
  }

  @Test
  void activate_unknownIdCsc_is404() {
    save(1L, 3, CSC_A);

    assertThatThrownBy(() -> service.activate(1L, 99L, 9))
        .isInstanceOfSatisfying(
            ResponseStatusException.class,
            e -> {
              assertThat(e.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
              assertThat(e.getReason()).isEqualTo("CSC_NOT_FOUND");
            });
  }

  @Test
  void eachTenantResolvesItsOwnCsc_andCannotSeeOrActivateAnothersCsc() {
    save(1L, 3, CSC_A);
    save(2L, 3, CSC_B); // same IdCSC number, different salon, different secret

    assertThat(service.resolveActive(1L).secret()).isEqualTo(CSC_A);
    assertThat(service.resolveActive(2L).secret()).isEqualTo(CSC_B);
    assertThat(service.list(1L)).hasSize(1);
    assertThat(service.list(2L)).hasSize(1);

    save(1L, 8, "ONLY1000000000000000000000000008");
    assertThatThrownBy(() -> service.activate(2L, 99L, 8))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("CSC_NOT_FOUND");
    assertThat(service.resolveActive(2L).secret()).isEqualTo(CSC_B);
  }

  @Test
  void aSecretRefOfAnotherTenantIsNeverResolved() {
    save(1L, 3, CSC_A);
    SifenCsc tenant1Row = rows.get(0);

    assertThatThrownBy(
            () ->
                store.load(
                    2L,
                    new SifenCscSecretStore.StoredCscRef(
                        tenant1Row.getSecretName(), tenant1Row.getSecretVersion())))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("tenant prefix mismatch");
  }

  @Test
  void withoutACsc_testEnvironmentFallsBackToTheSetsPublicTestCsc() {
    SifenActiveCsc resolved = service.resolveActive(1L);

    assertThat(resolved.idCsc()).isEqualTo(1);
    assertThat(resolved.secret()).isEqualTo("ABCD0000000000000000000000000000");
  }

  @Test
  void withoutACsc_productionFailsInsteadOfUsingATestCsc() {
    connectionProperties.setEnvironment(SifenConnectionProperties.Environment.PRODUCTION);

    assertThatThrownBy(() -> service.resolveActive(1L))
        .isInstanceOfSatisfying(
            ResponseStatusException.class,
            e -> {
              assertThat(e.getStatusCode()).isEqualTo(HttpStatus.PRECONDITION_FAILED);
              assertThat(e.getReason()).isEqualTo("SIFEN_CSC_NOT_CONFIGURED");
            });
  }

  @Test
  void withATenantCsc_productionUsesIt() {
    connectionProperties.setEnvironment(SifenConnectionProperties.Environment.PRODUCTION);
    save(1L, 12, CSC_A);

    assertThat(service.resolveActive(1L)).isEqualTo(new SifenActiveCsc(12, CSC_A));
  }

  @Test
  void invalidIdCsc_isRejectedWithoutStoringAnything() {
    for (Integer bad : new Integer[] {null, 0, -1, 10000}) {
      assertThatThrownBy(() -> service.save(1L, 99L, new SifenCscSaveRequest(bad, CSC_A)))
          .isInstanceOfSatisfying(
              ResponseStatusException.class,
              e -> {
                assertThat(e.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
                assertThat(e.getReason()).isEqualTo("INVALID_CSC_ID");
              });
    }
    verify(repository, never()).save(any(SifenCsc.class));
  }

  @Test
  void invalidCscFormat_isRejectedWithoutStoringAnything() {
    for (String bad :
        new String[] {
          null,
          "",
          "   ",
          "TOOSHORT",
          CSC_A + "X", // 33 chars
          "AAAA1111BBBB2222CCCC3333DDDD44-4", // symbol
          "AAAA1111BBBB2222CCCC3333DDDD 444" // space inside
        }) {
      assertThatThrownBy(() -> service.save(1L, 99L, new SifenCscSaveRequest(3, bad)))
          .isInstanceOfSatisfying(
              ResponseStatusException.class,
              e -> {
                assertThat(e.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
                assertThat(e.getReason()).isEqualTo("INVALID_CSC_FORMAT");
              });
    }
    verify(repository, never()).save(any(SifenCsc.class));
    assertThat(tempDir.toFile().list()).isEmpty();
  }

  @Test
  void surroundingWhitespaceIsTrimmed() {
    save(1L, 3, "  " + CSC_A + "\n");

    assertThat(service.resolveActive(1L).secret()).isEqualTo(CSC_A);
  }
}
