package com.cursorpoc.backend.service;

import com.cursorpoc.backend.bootstrap.FemmeDataInitializer;
import com.cursorpoc.backend.domain.Invoice;
import com.cursorpoc.backend.domain.Tenant;
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
import com.cursorpoc.backend.repository.TenantFeatureFlagRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class SeedResetService {

  private static final Logger log = LoggerFactory.getLogger(SeedResetService.class);
  private static final long DEMO_TENANT_ID = 1L;

  private final TenantRepository tenantRepository;
  private final AppUserRepository appUserRepository;
  private final BusinessProfileRepository businessProfileRepository;
  private final FiscalStampRepository fiscalStampRepository;
  private final TenantFeatureFlagRepository tenantFeatureFlagRepository;
  private final ServiceCategoryRepository serviceCategoryRepository;
  private final SalonServiceRepository salonServiceRepository;
  private final ProfessionalRepository professionalRepository;
  private final ProfessionalScheduleRepository professionalScheduleRepository;
  private final ProfessionalActivationTokenRepository professionalActivationTokenRepository;
  private final ClientRepository clientRepository;
  private final AppointmentRepository appointmentRepository;
  private final InvoiceRepository invoiceRepository;
  private final ServiceRecordRepository serviceRecordRepository;
  private final CashSessionRepository cashSessionRepository;
  private final PasswordResetTokenRepository passwordResetTokenRepository;
  private final AppUserTourStateRepository appUserTourStateRepository;
  private final FemmeDataInitializer femmeDataInitializer;

  public SeedResetService(
      TenantRepository tenantRepository,
      AppUserRepository appUserRepository,
      BusinessProfileRepository businessProfileRepository,
      FiscalStampRepository fiscalStampRepository,
      TenantFeatureFlagRepository tenantFeatureFlagRepository,
      ServiceCategoryRepository serviceCategoryRepository,
      SalonServiceRepository salonServiceRepository,
      ProfessionalRepository professionalRepository,
      ProfessionalScheduleRepository professionalScheduleRepository,
      ProfessionalActivationTokenRepository professionalActivationTokenRepository,
      ClientRepository clientRepository,
      AppointmentRepository appointmentRepository,
      InvoiceRepository invoiceRepository,
      ServiceRecordRepository serviceRecordRepository,
      CashSessionRepository cashSessionRepository,
      PasswordResetTokenRepository passwordResetTokenRepository,
      AppUserTourStateRepository appUserTourStateRepository,
      FemmeDataInitializer femmeDataInitializer) {
    this.tenantRepository = tenantRepository;
    this.appUserRepository = appUserRepository;
    this.businessProfileRepository = businessProfileRepository;
    this.fiscalStampRepository = fiscalStampRepository;
    this.tenantFeatureFlagRepository = tenantFeatureFlagRepository;
    this.serviceCategoryRepository = serviceCategoryRepository;
    this.salonServiceRepository = salonServiceRepository;
    this.professionalRepository = professionalRepository;
    this.professionalScheduleRepository = professionalScheduleRepository;
    this.professionalActivationTokenRepository = professionalActivationTokenRepository;
    this.clientRepository = clientRepository;
    this.appointmentRepository = appointmentRepository;
    this.invoiceRepository = invoiceRepository;
    this.serviceRecordRepository = serviceRecordRepository;
    this.cashSessionRepository = cashSessionRepository;
    this.passwordResetTokenRepository = passwordResetTokenRepository;
    this.appUserTourStateRepository = appUserTourStateRepository;
    this.femmeDataInitializer = femmeDataInitializer;
  }

  @Transactional
  public void resetDemoTenant() {
    log.info("POST /api/admin/seed/reset tenantId={} — starting reset", DEMO_TENANT_ID);

    Tenant tenant =
        tenantRepository
            .findById(DEMO_TENANT_ID)
            .orElseThrow(
                () ->
                    new ResponseStatusException(
                        HttpStatus.INTERNAL_SERVER_ERROR, "DEMO_TENANT_NOT_FOUND"));

    long deletedPasswordTokens =
        passwordResetTokenRepository.deleteByUser_Tenant_Id(DEMO_TENANT_ID);
    log.info("Deleted {} password_reset_tokens", deletedPasswordTokens);

    long deletedActivationTokens =
        professionalActivationTokenRepository.deleteByProfessional_Tenant_Id(DEMO_TENANT_ID);
    log.info("Deleted {} professional_activation_tokens", deletedActivationTokens);

    long deletedAppointments = appointmentRepository.deleteByTenant_Id(DEMO_TENANT_ID);
    log.info("Deleted {} appointments", deletedAppointments);

    List<Invoice> invoices = invoiceRepository.findAllByTenant_Id(DEMO_TENANT_ID);
    invoiceRepository.deleteAll(invoices);
    log.info("Deleted {} invoices (with lines and payment allocations)", invoices.size());

    // Must run before deleting clients/services/professionals below: service_records (and its
    // lines/tips, cascaded at the DB level) reference all three and would otherwise trip their FKs.
    long deletedServiceRecords = serviceRecordRepository.deleteByTenant_Id(DEMO_TENANT_ID);
    log.info("Deleted {} service_records (with lines and tips)", deletedServiceRecords);

    long deletedCashSessions = cashSessionRepository.deleteByTenant_Id(DEMO_TENANT_ID);
    log.info("Deleted {} cash_sessions", deletedCashSessions);

    long deletedSchedules =
        professionalScheduleRepository.deleteByProfessional_Tenant_Id(DEMO_TENANT_ID);
    log.info("Deleted {} professional_schedules", deletedSchedules);

    long deletedProfessionals = professionalRepository.deleteByTenant_Id(DEMO_TENANT_ID);
    log.info("Deleted {} professionals", deletedProfessionals);

    long deletedServices = salonServiceRepository.deleteByTenant_Id(DEMO_TENANT_ID);
    log.info("Deleted {} services", deletedServices);

    long deletedCategories = serviceCategoryRepository.deleteByTenant_Id(DEMO_TENANT_ID);
    log.info("Deleted {} service_categories", deletedCategories);

    // Safety net: findAllByTenant_Id above only catches invoices whose own tenant_id
    // matches. An invoice created concurrently (e.g. by a live demo visitor) or with a
    // mismatched tenant_id can still reference a demo-tenant client and would otherwise
    // trip fk_inv_client on the client delete below.
    List<Invoice> strayInvoices = invoiceRepository.findAllByClient_Tenant_Id(DEMO_TENANT_ID);
    if (!strayInvoices.isEmpty()) {
      invoiceRepository.deleteAll(strayInvoices);
      log.info("Deleted {} stray invoices referencing demo-tenant clients", strayInvoices.size());
    }

    long deletedClients = clientRepository.deleteByTenant_Id(DEMO_TENANT_ID);
    log.info("Deleted {} clients", deletedClients);

    long deletedTenantFlags = tenantFeatureFlagRepository.deleteByTenantId(DEMO_TENANT_ID);
    log.info("Deleted {} tenant_feature_flags", deletedTenantFlags);

    // Only unlocked (never-invoiced) stamps are reseedable placeholders. A stamp already
    // referenced by a real invoice (lockedAfterInvoice=true, e.g. tenant 1's real SIFEN timbrado)
    // must survive a reset — deleting it would let FemmeDataInitializer recreate the fake
    // "12345678" placeholder with nextEmissionNumber back at 1, reintroducing SIFEN
    // dCodRes=1002 "Documento electrónico duplicado" the next time an invoice is submitted.
    long deletedFiscalStamps =
        fiscalStampRepository.deleteByTenant_IdAndLockedAfterInvoiceFalse(DEMO_TENANT_ID);
    log.info("Deleted {} fiscal_stamps", deletedFiscalStamps);

    businessProfileRepository.deleteById(DEMO_TENANT_ID);
    log.info("Deleted business_profile for tenant id={}", DEMO_TENANT_ID);

    // Must run before deleting app_users: app_user_tour_state has a FK to app_users.
    long deletedTourState = appUserTourStateRepository.deleteByUser_Tenant_Id(DEMO_TENANT_ID);
    log.info("Deleted {} app_user_tour_state", deletedTourState);

    long deletedUsers = appUserRepository.deleteByTenant_Id(DEMO_TENANT_ID);
    log.info("Deleted {} app_users", deletedUsers);

    femmeDataInitializer.seedDemoTenantData(tenant);
    femmeDataInitializer.seedCatalogFromCsv(tenant);
    femmeDataInitializer.seedClientsFromCsv(tenant);

    log.info("POST /api/admin/seed/reset tenantId={} — reset complete", DEMO_TENANT_ID);
  }
}
