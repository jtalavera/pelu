package com.cursorpoc.backend.bootstrap;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.config.FemmePlatformAdminProperties;
import com.cursorpoc.backend.config.FemmeSystemAdminProperties;
import com.cursorpoc.backend.domain.Client;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.repository.AppUserRepository;
import com.cursorpoc.backend.repository.AppointmentRepository;
import com.cursorpoc.backend.repository.BusinessProfileRepository;
import com.cursorpoc.backend.repository.ClientRepository;
import com.cursorpoc.backend.repository.FeatureFlagRepository;
import com.cursorpoc.backend.repository.FiscalStampRepository;
import com.cursorpoc.backend.repository.InvoiceRepository;
import com.cursorpoc.backend.repository.ProfessionalRepository;
import com.cursorpoc.backend.repository.ProfessionalScheduleRepository;
import com.cursorpoc.backend.repository.SalonServiceRepository;
import com.cursorpoc.backend.repository.ServiceCategoryRepository;
import com.cursorpoc.backend.repository.TaxRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.crypto.password.PasswordEncoder;

/**
 * Regression test for the prod incident where {@code seedClientsFromCsv} hard-deleted a client
 * absent from the static seed CSV on every boot, even though the client had real invoices/
 * appointments, tripping fk_inv_client / fk_appt_client and crash-looping the container.
 */
@ExtendWith(MockitoExtension.class)
class FemmeDataInitializerTest {

  @Mock private TenantRepository tenantRepository;
  @Mock private AppUserRepository appUserRepository;
  @Mock private BusinessProfileRepository businessProfileRepository;
  @Mock private FiscalStampRepository fiscalStampRepository;
  @Mock private FeatureFlagRepository featureFlagRepository;
  @Mock private ServiceCategoryRepository serviceCategoryRepository;
  @Mock private SalonServiceRepository salonServiceRepository;
  @Mock private ProfessionalRepository professionalRepository;
  @Mock private ProfessionalScheduleRepository professionalScheduleRepository;
  @Mock private TaxRepository taxRepository;
  @Mock private ClientRepository clientRepository;
  @Mock private InvoiceRepository invoiceRepository;
  @Mock private AppointmentRepository appointmentRepository;
  @Mock private FemmeSystemAdminProperties systemAdminProperties;
  @Mock private FemmePlatformAdminProperties platformAdminProperties;
  @Mock private PasswordEncoder passwordEncoder;

  private FemmeDataInitializer initializer;
  private Tenant tenant;

  @BeforeEach
  void setUp() {
    initializer =
        new FemmeDataInitializer(
            tenantRepository,
            appUserRepository,
            businessProfileRepository,
            fiscalStampRepository,
            featureFlagRepository,
            serviceCategoryRepository,
            salonServiceRepository,
            professionalRepository,
            professionalScheduleRepository,
            taxRepository,
            clientRepository,
            invoiceRepository,
            appointmentRepository,
            systemAdminProperties,
            platformAdminProperties,
            passwordEncoder);
    tenant = new Tenant();
    tenant.setId(1L);
  }

  @Test
  void seedClientsFromCsv_keepsClientWithInvoiceEvenIfAbsentFromCsv() {
    Client staleButInvoiced = new Client();
    staleButInvoiced.setId(999L);
    staleButInvoiced.setTenant(tenant);
    staleButInvoiced.setFullName("ZZZ Not In Seed CSV Test Client");
    staleButInvoiced.setActive(true);

    when(clientRepository.findByTenant_Id(1L)).thenReturn(List.of(staleButInvoiced));
    when(invoiceRepository.existsByClient_Id(999L)).thenReturn(true);

    initializer.seedClientsFromCsv(tenant);

    verify(clientRepository, never()).delete(any());
  }

  @Test
  void seedClientsFromCsv_keepsClientWithAppointmentEvenIfAbsentFromCsv() {
    Client staleButBooked = new Client();
    staleButBooked.setId(998L);
    staleButBooked.setTenant(tenant);
    staleButBooked.setFullName("ZZZ Not In Seed CSV Test Client 2");
    staleButBooked.setActive(true);

    when(clientRepository.findByTenant_Id(1L)).thenReturn(List.of(staleButBooked));
    when(invoiceRepository.existsByClient_Id(998L)).thenReturn(false);
    when(appointmentRepository.existsByClient_Id(998L)).thenReturn(true);

    initializer.seedClientsFromCsv(tenant);

    verify(clientRepository, never()).delete(any());
  }

  @Test
  void seedClientsFromCsv_deletesStaleClientWithNoInvoiceOrAppointment() {
    Client trulyStale = new Client();
    trulyStale.setId(997L);
    trulyStale.setTenant(tenant);
    trulyStale.setFullName("ZZZ Not In Seed CSV Test Client 3");
    trulyStale.setActive(true);

    when(clientRepository.findByTenant_Id(1L)).thenReturn(List.of(trulyStale));
    when(invoiceRepository.existsByClient_Id(997L)).thenReturn(false);
    when(appointmentRepository.existsByClient_Id(997L)).thenReturn(false);

    initializer.seedClientsFromCsv(tenant);

    verify(clientRepository).delete(trulyStale);
  }
}
