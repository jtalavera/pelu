package com.cursorpoc.backend.service;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.domain.Client;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.repository.AppointmentRepository;
import com.cursorpoc.backend.repository.ClientRepository;
import com.cursorpoc.backend.repository.InvoiceRepository;
import com.cursorpoc.backend.repository.SalonServiceRepository;
import com.cursorpoc.backend.repository.ServiceCategoryRepository;
import com.cursorpoc.backend.repository.TaxRepository;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

/**
 * Regression test for the prod incident where {@code seedClientsFromCsv} hard-deleted a client
 * absent from the static seed CSV on every boot, even though the client had real invoices/
 * appointments, tripping fk_inv_client / fk_appt_client and crash-looping the container.
 *
 * <p>HU-56: this reconciliation moved out of {@code FemmeDataInitializer} (no longer runs at boot)
 * into this class, which only {@code SeedResetService}'s e2e/dev-only reset endpoint calls.
 */
@ExtendWith(MockitoExtension.class)
class DemoTenantCatalogSeedServiceTest {

  @Mock private ServiceCategoryRepository serviceCategoryRepository;
  @Mock private SalonServiceRepository salonServiceRepository;
  @Mock private TaxRepository taxRepository;
  @Mock private ClientRepository clientRepository;
  @Mock private InvoiceRepository invoiceRepository;
  @Mock private AppointmentRepository appointmentRepository;

  private DemoTenantCatalogSeedService seedService;
  private Tenant tenant;

  @BeforeEach
  void setUp() {
    seedService =
        new DemoTenantCatalogSeedService(
            serviceCategoryRepository,
            salonServiceRepository,
            taxRepository,
            clientRepository,
            invoiceRepository,
            appointmentRepository);
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

    seedService.seedClientsFromCsv(tenant);

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

    seedService.seedClientsFromCsv(tenant);

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

    seedService.seedClientsFromCsv(tenant);

    verify(clientRepository).delete(trulyStale);
  }
}
