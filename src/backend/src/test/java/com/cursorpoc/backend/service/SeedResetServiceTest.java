package com.cursorpoc.backend.service;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.bootstrap.FemmeDataInitializer;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.repository.AppUserActivationTokenRepository;
import com.cursorpoc.backend.repository.AppUserRepository;
import com.cursorpoc.backend.repository.AppUserTourStateRepository;
import com.cursorpoc.backend.repository.AppointmentRepository;
import com.cursorpoc.backend.repository.BusinessProfileRepository;
import com.cursorpoc.backend.repository.CashSessionRepository;
import com.cursorpoc.backend.repository.ClientRepository;
import com.cursorpoc.backend.repository.FiscalStampRepository;
import com.cursorpoc.backend.repository.InvoiceRepository;
import com.cursorpoc.backend.repository.PasswordResetTokenRepository;
import com.cursorpoc.backend.repository.ProfessionalActivationTokenRepository;
import com.cursorpoc.backend.repository.ProfessionalRepository;
import com.cursorpoc.backend.repository.ProfessionalScheduleRepository;
import com.cursorpoc.backend.repository.SalonServiceRepository;
import com.cursorpoc.backend.repository.ServiceCategoryRepository;
import com.cursorpoc.backend.repository.ServiceRecordRepository;
import com.cursorpoc.backend.repository.SifenCertificateRepository;
import com.cursorpoc.backend.repository.TenantFeatureFlagRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.repository.TipWithdrawalRepository;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

/**
 * SeedResetService.resetDemoTenant() is the only caller of FiscalStampRepository's tenant-wide
 * fiscal-stamp delete. This test guards that it now deletes only unlocked (never-invoiced)
 * placeholder stamps, never a stamp already used for a real SIFEN submission — see
 * FiscalStampRepository.deleteByTenant_IdAndLockedAfterInvoiceFalse.
 */
@ExtendWith(MockitoExtension.class)
class SeedResetServiceTest {

  private static final long DEMO_TENANT_ID = 1L;

  @Mock private TenantRepository tenantRepository;
  @Mock private AppUserRepository appUserRepository;
  @Mock private BusinessProfileRepository businessProfileRepository;
  @Mock private FiscalStampRepository fiscalStampRepository;
  @Mock private TenantFeatureFlagRepository tenantFeatureFlagRepository;
  @Mock private ServiceCategoryRepository serviceCategoryRepository;
  @Mock private SalonServiceRepository salonServiceRepository;
  @Mock private ProfessionalRepository professionalRepository;
  @Mock private ProfessionalScheduleRepository professionalScheduleRepository;
  @Mock private ProfessionalActivationTokenRepository professionalActivationTokenRepository;
  @Mock private AppUserActivationTokenRepository appUserActivationTokenRepository;
  @Mock private ClientRepository clientRepository;
  @Mock private AppointmentRepository appointmentRepository;
  @Mock private InvoiceRepository invoiceRepository;
  @Mock private ServiceRecordRepository serviceRecordRepository;
  @Mock private CashSessionRepository cashSessionRepository;
  @Mock private PasswordResetTokenRepository passwordResetTokenRepository;
  @Mock private AppUserTourStateRepository appUserTourStateRepository;
  @Mock private TipWithdrawalRepository tipWithdrawalRepository;
  @Mock private SifenCertificateRepository sifenCertificateRepository;
  @Mock private SifenCertificateSecretStore sifenCertificateSecretStore;
  @Mock private FemmeDataInitializer femmeDataInitializer;

  private SeedResetService service;

  @BeforeEach
  void setUp() {
    service =
        new SeedResetService(
            tenantRepository,
            appUserRepository,
            businessProfileRepository,
            fiscalStampRepository,
            tenantFeatureFlagRepository,
            serviceCategoryRepository,
            salonServiceRepository,
            professionalRepository,
            professionalScheduleRepository,
            professionalActivationTokenRepository,
            appUserActivationTokenRepository,
            clientRepository,
            appointmentRepository,
            invoiceRepository,
            serviceRecordRepository,
            cashSessionRepository,
            passwordResetTokenRepository,
            appUserTourStateRepository,
            tipWithdrawalRepository,
            sifenCertificateRepository,
            sifenCertificateSecretStore,
            femmeDataInitializer);

    Tenant tenant = new Tenant();
    tenant.setId(DEMO_TENANT_ID);
    when(tenantRepository.findById(DEMO_TENANT_ID)).thenReturn(Optional.of(tenant));
    when(invoiceRepository.findAllByTenant_Id(DEMO_TENANT_ID)).thenReturn(List.of());
    when(invoiceRepository.findAllByClient_Tenant_Id(DEMO_TENANT_ID)).thenReturn(List.of());
  }

  @Test
  void resetDemoTenant_onlyDeletesUnlockedFiscalStamps() {
    service.resetDemoTenant();

    verify(fiscalStampRepository).deleteByTenant_IdAndLockedAfterInvoiceFalse(DEMO_TENANT_ID);
    verify(fiscalStampRepository, never()).deleteByTenant_Id(any());
  }

  // HU-58: reset no longer reconciles a hardcoded catalog/client CSV (DemoTenantCatalogSeedService
  // was removed) — it only restores the tenant's admin login capability.
  @Test
  void resetDemoTenant_reseedsAdminLoginAfterDeletingUnlockedStamps() {
    service.resetDemoTenant();

    verify(femmeDataInitializer, times(1)).seedDemoTenantData(any(Tenant.class));
  }

  // RT-12: sifen_certificates.uploaded_by_user_id FKs to app_users, so the certificate cleanup
  // must run before app_users are deleted — otherwise any e2e/dev run that had ever uploaded a
  // certificate for this tenant would make every subsequent reset fail with a referential-integrity
  // violation. Locks in both the DB-row cleanup and the backing secret-store file cleanup.
  @Test
  void resetDemoTenant_deletesSifenCertificatesAndTheirSecrets() {
    service.resetDemoTenant();

    verify(sifenCertificateRepository).deleteByTenant_Id(DEMO_TENANT_ID);
    verify(sifenCertificateSecretStore).deleteAll(DEMO_TENANT_ID);
  }
}
