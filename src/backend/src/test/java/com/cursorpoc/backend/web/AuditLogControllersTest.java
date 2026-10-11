package com.cursorpoc.backend.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.service.AuditLogService;
import com.cursorpoc.backend.web.dto.AuditLogResponse;
import com.cursorpoc.backend.web.dto.PageResponse;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/**
 * Issue #284: the salon administrator reads only THEIR salon's audit trail; the root user reads
 * every salon's; nobody else reads either.
 */
@ExtendWith(MockitoExtension.class)
class AuditLogControllersTest {

  private static final FemmeUserPrincipal ROOT =
      new FemmeUserPrincipal(1L, null, "root@pelu", UserRole.PLATFORM_ADMIN, null);
  private static final FemmeUserPrincipal ADMIN =
      new FemmeUserPrincipal(2L, 7L, "admin@salon.test", UserRole.ADMIN, null);
  private static final FemmeUserPrincipal PROFESSIONAL =
      new FemmeUserPrincipal(3L, 7L, "pro@salon.test", UserRole.PROFESSIONAL, 9L);

  private static final PageResponse<AuditLogResponse> EMPTY =
      new PageResponse<>(List.of(), 0, 20, 0, 0);

  @Mock private AuditLogService service;

  private static void assertStatus(Runnable call, HttpStatus status) {
    assertThatThrownBy(call::run)
        .isInstanceOfSatisfying(
            ResponseStatusException.class,
            e -> assertThat(e.getStatusCode().value()).isEqualTo(status.value()));
  }

  @Test
  void tenantAudit_isScopedToTheCallersOwnTenant() {
    when(service.search(7L, "2026-10-01", null, null, "ana", 0, 20)).thenReturn(EMPTY);

    var out = new AuditLogController(service).list(ADMIN, "2026-10-01", null, null, "ana", 0, 20);

    assertThat(out).isSameAs(EMPTY);
    verify(service).search(7L, "2026-10-01", null, null, "ana", 0, 20);
  }

  @Test
  void tenantAudit_isForbiddenToProfessionalsAndRoot_unauthorizedWithoutSession() {
    AuditLogController controller = new AuditLogController(service);
    assertStatus(
        () -> controller.list(PROFESSIONAL, null, null, null, null, 0, 20), HttpStatus.FORBIDDEN);
    assertStatus(() -> controller.list(ROOT, null, null, null, null, 0, 20), HttpStatus.FORBIDDEN);
    assertStatus(
        () -> controller.list(null, null, null, null, null, 0, 20), HttpStatus.UNAUTHORIZED);
    verifyNoInteractions(service);
  }

  @Test
  void platformAudit_rootSeesAnyTenantOrAll() {
    when(service.search(null, null, null, null, null, 0, 20)).thenReturn(EMPTY);
    when(service.search(7L, null, null, null, null, 0, 20)).thenReturn(EMPTY);
    PlatformAuditController controller = new PlatformAuditController(service);

    controller.list(ROOT, null, null, null, null, null, 0, 20);
    controller.list(ROOT, 7L, null, null, null, null, 0, 20);

    verify(service).search(null, null, null, null, null, 0, 20);
    verify(service).search(7L, null, null, null, null, 0, 20);
  }

  @Test
  void platformAudit_isForbiddenToSalonUsers() {
    PlatformAuditController controller = new PlatformAuditController(service);
    assertStatus(
        () -> controller.list(ADMIN, null, null, null, null, null, 0, 20), HttpStatus.FORBIDDEN);
    assertStatus(
        () -> controller.list(PROFESSIONAL, null, null, null, null, null, 0, 20),
        HttpStatus.FORBIDDEN);
    assertStatus(
        () -> controller.list(null, null, null, null, null, null, 0, 20), HttpStatus.UNAUTHORIZED);
    verifyNoInteractions(service);
  }
}
