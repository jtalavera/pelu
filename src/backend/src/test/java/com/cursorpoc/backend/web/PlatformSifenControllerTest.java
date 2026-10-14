package com.cursorpoc.backend.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.config.SifenConnectionProperties;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.service.SifenCertificateService;
import com.cursorpoc.backend.service.SifenCscService;
import com.cursorpoc.backend.web.dto.SifenCertificateUploadRequest;
import com.cursorpoc.backend.web.dto.SifenCscResponse;
import com.cursorpoc.backend.web.dto.SifenCscSaveRequest;
import java.lang.reflect.Method;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.server.ResponseStatusException;

/**
 * The SIFEN certificate and the CSC of a tenant are loaded ONLY by the platform's root user ({@code
 * PLATFORM_ADMIN}) — never by the salon's administrator, who gets a read-only view.
 */
@ExtendWith(MockitoExtension.class)
class PlatformSifenControllerTest {

  private static final long TENANT_ID = 7L;

  private static final FemmeUserPrincipal ROOT =
      new FemmeUserPrincipal(1L, null, "root@pelu", UserRole.PLATFORM_ADMIN, null);
  private static final FemmeUserPrincipal TENANT_ADMIN =
      new FemmeUserPrincipal(2L, TENANT_ID, "admin@salon.test", UserRole.ADMIN, null);
  private static final FemmeUserPrincipal PROFESSIONAL =
      new FemmeUserPrincipal(3L, TENANT_ID, "pro@salon.test", UserRole.PROFESSIONAL, 9L);

  private static final SifenCertificateUploadRequest CERT_REQUEST =
      new SifenCertificateUploadRequest("ZmFrZQ==", "secret");
  private static final SifenCscSaveRequest CSC_REQUEST =
      new SifenCscSaveRequest(5, "A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6");

  @Mock private TenantRepository tenantRepository;
  @Mock private SifenCertificateService certificateService;
  @Mock private SifenCscService cscService;

  private PlatformSifenController controller;

  @BeforeEach
  void setUp() {
    controller =
        new PlatformSifenController(
            tenantRepository, certificateService, cscService, new SifenConnectionProperties());
  }

  private static void assertStatus(Runnable call, HttpStatus expected) {
    assertThatThrownBy(call::run)
        .isInstanceOfSatisfying(
            ResponseStatusException.class, e -> assertThat(e.getStatusCode()).isEqualTo(expected));
  }

  @Test
  void theTenantAdminCannotLoadACertificateOrACsc_noService_isTouched() {
    assertStatus(
        () -> controller.uploadCertificate(TENANT_ADMIN, TENANT_ID, CERT_REQUEST),
        HttpStatus.FORBIDDEN);
    assertStatus(
        () -> controller.saveCsc(TENANT_ADMIN, TENANT_ID, CSC_REQUEST), HttpStatus.FORBIDDEN);
    assertStatus(() -> controller.activateCsc(TENANT_ADMIN, TENANT_ID, 5), HttpStatus.FORBIDDEN);
    assertStatus(() -> controller.listCertificates(TENANT_ADMIN, TENANT_ID), HttpStatus.FORBIDDEN);
    assertStatus(() -> controller.listCsc(TENANT_ADMIN, TENANT_ID), HttpStatus.FORBIDDEN);

    verifyNoInteractions(certificateService, cscService);
  }

  @Test
  void aProfessionalCannotEither() {
    assertStatus(
        () -> controller.uploadCertificate(PROFESSIONAL, TENANT_ID, CERT_REQUEST),
        HttpStatus.FORBIDDEN);
    assertStatus(
        () -> controller.saveCsc(PROFESSIONAL, TENANT_ID, CSC_REQUEST), HttpStatus.FORBIDDEN);
    verifyNoInteractions(certificateService, cscService);
  }

  @Test
  void anAnonymousCallerIsUnauthorized() {
    assertStatus(
        () -> controller.uploadCertificate(null, TENANT_ID, CERT_REQUEST), HttpStatus.UNAUTHORIZED);
    assertStatus(() -> controller.saveCsc(null, TENANT_ID, CSC_REQUEST), HttpStatus.UNAUTHORIZED);
    verifyNoInteractions(certificateService, cscService);
  }

  @Test
  void theRootUserUploadsTheCertificateForTheTenantInThePath() {
    controller.uploadCertificate(ROOT, TENANT_ID, CERT_REQUEST);

    // The target tenant is the PATH's (the root user has no tenant of its own); the uploader
    // recorded is the root user.
    verify(certificateService).upload(TENANT_ID, 1L, CERT_REQUEST);
  }

  @Test
  void theRootUserLoadsAndActivatesTheCscForTheTenantInThePath() {
    when(cscService.save(TENANT_ID, 1L, CSC_REQUEST))
        .thenReturn(new SifenCscResponse(5, true, Instant.now(), Instant.now()));

    assertThat(controller.saveCsc(ROOT, TENANT_ID, CSC_REQUEST).idCsc()).isEqualTo(5);
    controller.activateCsc(ROOT, TENANT_ID, 5);

    verify(cscService).activate(TENANT_ID, 1L, 5);
  }

  @Test
  void theRootUserListsWhatEachTenantHas() {
    Tenant tenant = new Tenant();
    tenant.setId(TENANT_ID);
    when(tenantRepository.findById(TENANT_ID)).thenReturn(Optional.of(tenant));
    when(cscService.list(TENANT_ID)).thenReturn(List.of());
    when(certificateService.list(TENANT_ID)).thenReturn(List.of());

    assertThat(controller.listCsc(ROOT, TENANT_ID)).isEmpty();
    assertThat(controller.listCertificates(ROOT, TENANT_ID)).isEmpty();
  }

  @Test
  void theInfoNamesTheTenantAndTheSifenEnvironment() {
    Tenant tenant = new Tenant();
    tenant.setId(TENANT_ID);
    tenant.setName("Salón Aurora");
    when(tenantRepository.findById(TENANT_ID)).thenReturn(Optional.of(tenant));

    PlatformSifenController.TenantSifenInfo info = controller.info(ROOT, TENANT_ID);

    assertThat(info.tenantName()).isEqualTo("Salón Aurora");
    assertThat(info.environment()).isEqualTo("TEST");
  }

  @Test
  void anUnknownTenantIs404() {
    when(tenantRepository.findById(any())).thenReturn(Optional.empty());

    assertStatus(() -> controller.listCsc(ROOT, 999L), HttpStatus.NOT_FOUND);
    assertStatus(() -> controller.info(ROOT, 999L), HttpStatus.NOT_FOUND);
    verify(cscService, never()).list(999L);
  }

  /**
   * Guard: the salon-side controllers must stay read-only. If somebody adds a write endpoint to
   * them again, the "only the root user loads certificates and CSC" rule is silently broken.
   */
  @Test
  void theTenantSideControllersExposeNoWriteEndpoints() {
    for (Class<?> c : List.of(SifenCertificateController.class, SifenCscController.class)) {
      for (Method m : c.getDeclaredMethods()) {
        assertThat(m.isAnnotationPresent(PostMapping.class))
            .as("%s.%s must not be a POST endpoint", c.getSimpleName(), m.getName())
            .isFalse();
        assertThat(m.isAnnotationPresent(PutMapping.class))
            .as("%s.%s must not be a PUT endpoint", c.getSimpleName(), m.getName())
            .isFalse();
      }
    }
  }
}
