package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.AuditLog;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.repository.AuditLogRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.web.server.ResponseStatusException;

/** Issue #284: the audit trail — what is recorded, what is not, and how it is searched. */
@ExtendWith(MockitoExtension.class)
class AuditLogServiceTest {

  @Mock private AuditLogRepository repository;
  @Mock private TenantRepository tenantRepository;

  private AuditLogService service() {
    return new AuditLogService(repository, tenantRepository, new FemmeTimeProperties());
  }

  @Test
  void isAuditable_onlyDataChangingApiCalls() {
    assertThat(AuditLogService.isAuditable("POST", "/api/invoices")).isTrue();
    assertThat(AuditLogService.isAuditable("PUT", "/api/clients/{id}")).isTrue();
    assertThat(AuditLogService.isAuditable("PATCH", "/api/appointments/{id}/status")).isTrue();
    assertThat(AuditLogService.isAuditable("DELETE", "/api/fiscal-stamps/{id}")).isTrue();
    assertThat(AuditLogService.isAuditable("POST", "/api/platform/tenants")).isTrue();

    assertThat(AuditLogService.isAuditable("GET", "/api/invoices")).isFalse();
    assertThat(AuditLogService.isAuditable("POST", "/api/auth/login")).isFalse();
    assertThat(AuditLogService.isAuditable("POST", "/api/auth/refresh")).isFalse();
    assertThat(AuditLogService.isAuditable("POST", "/api/integration/oauth/token")).isFalse();
    assertThat(AuditLogService.isAuditable("POST", "/api/whatsapp/webhook")).isFalse();
    assertThat(AuditLogService.isAuditable("POST", "/api/me/tour-state/{key}")).isFalse();
    assertThat(AuditLogService.isAuditable("POST", "/api/sso/stock")).isFalse();
    assertThat(AuditLogService.isAuditable("POST", "/api/admin/sifen-test-support/csc/clear"))
        .isFalse();
    assertThat(
            AuditLogService.isAuditable(
                "POST", "/api/platform/import-templates/{entity}/validate-headers"))
        .isFalse();
    assertThat(AuditLogService.isAuditable("POST", "/health")).isFalse();
    assertThat(AuditLogService.isAuditable(null, "/api/invoices")).isFalse();
  }

  @Test
  void resourceAndOperation_splitsTheEndpointTemplate() {
    assertThat(AuditLogService.resourceAndOperation("/api/invoices"))
        .containsExactly("invoices", null);
    assertThat(AuditLogService.resourceAndOperation("/api/clients/{id}"))
        .containsExactly("clients", null);
    assertThat(AuditLogService.resourceAndOperation("/api/invoices/{id}/void"))
        .containsExactly("invoices", "void");
    assertThat(AuditLogService.resourceAndOperation("/api/invoices/{id}/sifen/cancel"))
        .containsExactly("invoices", "cancel");
    assertThat(AuditLogService.resourceAndOperation("/api/cash-sessions/open"))
        .containsExactly("cash-sessions", "open");
    assertThat(AuditLogService.resourceAndOperation("/api/platform/tenants/{id}/status"))
        .containsExactly("tenants", "status");
    assertThat(AuditLogService.resourceAndOperation("/api/platform/tiers"))
        .containsExactly("tiers", null);
    assertThat(AuditLogService.resourceAndOperation("/api/admin/feature-flags/{flagKey}"))
        .containsExactly("feature-flags", null);
    assertThat(
            AuditLogService.resourceAndOperation(
                "/api/platform/tenants/{tenantId}/sifen/csc/{idCsc}/activate"))
        .containsExactly("tenants", "activate");
    assertThat(AuditLogService.resourceAndOperation("/api/business-profile"))
        .containsExactly("business-profile", null);
  }

  @Test
  void record_storesWhoWhatAndWhichRecord_neverABody() {
    FemmeUserPrincipal admin =
        new FemmeUserPrincipal(5L, 7L, "admin@salon.test", UserRole.ADMIN, null);

    service().record(admin, "post", "/api/invoices/{id}/void", "42", 200);

    ArgumentCaptor<AuditLog> saved = ArgumentCaptor.forClass(AuditLog.class);
    verify(repository).save(saved.capture());
    AuditLog row = saved.getValue();
    assertThat(row.getTenantId()).isEqualTo(7L);
    assertThat(row.getUserId()).isEqualTo(5L);
    assertThat(row.getUserEmail()).isEqualTo("admin@salon.test");
    assertThat(row.getUserRole()).isEqualTo("ADMIN");
    assertThat(row.getHttpMethod()).isEqualTo("POST");
    assertThat(row.getResource()).isEqualTo("invoices");
    assertThat(row.getOperation()).isEqualTo("void");
    assertThat(row.getPathPattern()).isEqualTo("/api/invoices/{id}/void");
    assertThat(row.getEntityId()).isEqualTo("42");
    assertThat(row.getStatusCode()).isEqualTo(200);
    assertThat(row.getCreatedAt()).isNotNull();
  }

  @Test
  void record_forTheRootUserHasNoTenant() {
    FemmeUserPrincipal root =
        new FemmeUserPrincipal(1L, null, "root@pelu", UserRole.PLATFORM_ADMIN, null);

    service().record(root, "POST", "/api/platform/tenants", null, 201);

    ArgumentCaptor<AuditLog> saved = ArgumentCaptor.forClass(AuditLog.class);
    verify(repository).save(saved.capture());
    assertThat(saved.getValue().getTenantId()).isNull();
    assertThat(saved.getValue().getUserRole()).isEqualTo("PLATFORM_ADMIN");
  }

  @Test
  void record_neverThrows_soAuditingCannotBreakTheRequest() {
    when(repository.save(any())).thenThrow(new IllegalStateException("db down"));
    FemmeUserPrincipal admin = new FemmeUserPrincipal(5L, 7L, "a@b.c", UserRole.ADMIN, null);

    assertThatCode(() -> service().record(admin, "POST", "/api/clients", null, 201))
        .doesNotThrowAnyException();
  }

  @Test
  void search_resolvesTenantNamesAndPassesFilters() {
    AuditLog row = new AuditLog();
    row.setId(1L);
    row.setTenantId(7L);
    row.setUserEmail("admin@salon.test");
    row.setUserRole("ADMIN");
    row.setHttpMethod("POST");
    row.setResource("invoices");
    row.setPathPattern("/api/invoices");
    row.setStatusCode(201);
    row.setCreatedAt(Instant.parse("2026-10-08T12:00:00Z"));
    when(repository.search(eq(7L), any(), any(), eq("invoices"), eq("admin"), any()))
        .thenReturn(new PageImpl<>(List.of(row), PageRequest.of(0, 20), 1));
    Tenant tenant = new Tenant();
    tenant.setId(7L);
    tenant.setName("Salón Aurora");
    when(tenantRepository.findById(7L)).thenReturn(Optional.of(tenant));

    var page = service().search(7L, "2026-10-01", "2026-10-08", "invoices", " admin ", 0, 20);

    assertThat(page.totalElements()).isEqualTo(1);
    assertThat(page.content())
        .singleElement()
        .satisfies(
            r -> {
              assertThat(r.tenantName()).isEqualTo("Salón Aurora");
              assertThat(r.userEmail()).isEqualTo("admin@salon.test");
              assertThat(r.resource()).isEqualTo("invoices");
            });
  }

  @Test
  void search_clampsThePageSize() {
    when(repository.search(any(), any(), any(), any(), any(), any()))
        .thenReturn(new PageImpl<>(List.of()));
    service().search(7L, null, null, null, null, 0, 100_000);

    ArgumentCaptor<org.springframework.data.domain.Pageable> pageable =
        ArgumentCaptor.forClass(org.springframework.data.domain.Pageable.class);
    verify(repository).search(any(), any(), any(), any(), any(), pageable.capture());
    assertThat(pageable.getValue().getPageSize()).isEqualTo(AuditLogService.MAX_PAGE_SIZE);
  }

  @Test
  void search_rejectsAnInvertedOrMalformedDateRange() {
    assertThatThrownBy(() -> service().search(7L, "2026-10-09", "2026-10-01", null, null, 0, 20))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("INVALID_DATE_RANGE");
    assertThatThrownBy(() -> service().search(7L, "not-a-date", null, null, null, 0, 20))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("INVALID_DATE_RANGE");
  }
}
