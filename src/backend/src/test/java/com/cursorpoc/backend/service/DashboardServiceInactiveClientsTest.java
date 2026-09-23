package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.enums.AppointmentStatus;
import com.cursorpoc.backend.repository.AppointmentRepository;
import com.cursorpoc.backend.repository.ClientRepository;
import com.cursorpoc.backend.repository.FiscalStampRepository;
import com.cursorpoc.backend.repository.InvoiceRepository;
import com.cursorpoc.backend.web.dto.DashboardResponse;
import java.time.Instant;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

/** Issue #216 — "Panel de clientes inactivos": unit coverage of {@link DashboardService}. */
@ExtendWith(MockitoExtension.class)
class DashboardServiceInactiveClientsTest {

  private static final ZoneId ZONE = ZoneId.of("America/Asuncion");

  @Mock private AppointmentRepository appointmentRepository;
  @Mock private ClientRepository clientRepository;
  @Mock private InvoiceRepository invoiceRepository;
  @Mock private FiscalStampRepository fiscalStampRepository;
  @Mock private BusinessProfileService businessProfileService;
  @Mock private SifenNumberVoidingService sifenNumberVoidingService;

  private DashboardService dashboardService;

  private record Row(Long clientId, String fullName, String phone, Instant lastCompletedVisit)
      implements ClientRepository.InactiveClientRow {
    @Override
    public Long getClientId() {
      return clientId;
    }

    @Override
    public String getFullName() {
      return fullName;
    }

    @Override
    public String getPhone() {
      return phone;
    }

    @Override
    public Instant getLastCompletedVisit() {
      return lastCompletedVisit;
    }
  }

  @BeforeEach
  void setUp() {
    FemmeTimeProperties time = new FemmeTimeProperties();
    time.setBusinessZoneId(ZONE.getId());
    dashboardService =
        new DashboardService(
            time,
            appointmentRepository,
            clientRepository,
            invoiceRepository,
            fiscalStampRepository,
            businessProfileService,
            sifenNumberVoidingService);
    // lenient: the new buildInactiveClientsPage(...) tests don't go through build(), so these
    // fiscal-alert-only stubs would otherwise be flagged as unused by strict stubbing.
    lenient().when(businessProfileService.isRucReadyForInvoicing(1L)).thenReturn(true);
    lenient()
        .when(fiscalStampRepository.findByTenant_IdAndActiveTrue(1L))
        .thenReturn(Optional.empty());
  }

  private Instant daysAgo(long days) {
    return Instant.now().minus(days, ChronoUnit.DAYS);
  }

  @Test
  void excludesClientVisitedWithinThreshold() {
    when(clientRepository.findActiveClientsWithLastCompletedVisit(
            eq(1L), eq(AppointmentStatus.COMPLETED)))
        .thenReturn(List.of(new Row(1L, "Recently Active", "0981000000", daysAgo(10))));

    DashboardResponse d = dashboardService.build(1L);

    assertThat(d.inactiveClients()).isEmpty();
  }

  /** Off-by-one boundary: one day short of the threshold must still be excluded. */
  @Test
  void excludesClientOneDayBeforeThreshold() {
    when(clientRepository.findActiveClientsWithLastCompletedVisit(
            eq(1L), eq(AppointmentStatus.COMPLETED)))
        .thenReturn(
            List.of(
                new Row(
                    1L,
                    "Just Under Threshold",
                    "0981000000",
                    daysAgo(DashboardService.INACTIVE_CLIENT_THRESHOLD_DAYS - 1))));

    DashboardResponse d = dashboardService.build(1L);

    assertThat(d.inactiveClients()).isEmpty();
  }

  @Test
  void exposesThresholdDaysConstantInResponse() {
    when(clientRepository.findActiveClientsWithLastCompletedVisit(
            eq(1L), eq(AppointmentStatus.COMPLETED)))
        .thenReturn(List.of());

    DashboardResponse d = dashboardService.build(1L);

    assertThat(d.inactiveClientsThresholdDays())
        .isEqualTo(DashboardService.INACTIVE_CLIENT_THRESHOLD_DAYS);
  }

  @Test
  void includesClientAtOrPastThreshold() {
    when(clientRepository.findActiveClientsWithLastCompletedVisit(
            eq(1L), eq(AppointmentStatus.COMPLETED)))
        .thenReturn(
            List.of(
                new Row(
                    1L,
                    "Barely Inactive",
                    "0981000000",
                    daysAgo(DashboardService.INACTIVE_CLIENT_THRESHOLD_DAYS))));

    DashboardResponse d = dashboardService.build(1L);

    assertThat(d.inactiveClients()).hasSize(1);
    assertThat(d.inactiveClients().get(0).daysSinceLastVisit())
        .isGreaterThanOrEqualTo((long) DashboardService.INACTIVE_CLIENT_THRESHOLD_DAYS);
  }

  /**
   * Issue #216 follow-up: a client who never had a completed visit is not "inactive" — excluded.
   */
  @Test
  void neverVisitedClientIsExcluded() {
    when(clientRepository.findActiveClientsWithLastCompletedVisit(
            eq(1L), eq(AppointmentStatus.COMPLETED)))
        .thenReturn(
            List.of(
                new Row(1L, "Long Inactive", "0981000001", daysAgo(200)),
                new Row(2L, "Never Visited", "0981000002", null)));

    DashboardResponse d = dashboardService.build(1L);

    assertThat(d.inactiveClients()).hasSize(1);
    assertThat(d.inactiveClients().get(0).fullName()).isEqualTo("Long Inactive");
  }

  @Test
  void orderedByDaysOfInactivityDescending() {
    when(clientRepository.findActiveClientsWithLastCompletedVisit(
            eq(1L), eq(AppointmentStatus.COMPLETED)))
        .thenReturn(
            List.of(
                new Row(1L, "Ninety Days", "0981000001", daysAgo(90)),
                new Row(2L, "Three Hundred Days", "0981000002", daysAgo(300)),
                new Row(3L, "Hundred Fifty Days", "0981000003", daysAgo(150))));

    DashboardResponse d = dashboardService.build(1L);

    assertThat(d.inactiveClients())
        .extracting(DashboardResponse.InactiveClient::fullName)
        .containsExactly("Three Hundred Days", "Hundred Fifty Days", "Ninety Days");
  }

  @Test
  void limitedToTopN() {
    List<ClientRepository.InactiveClientRow> rows =
        java.util.stream.IntStream.rangeClosed(1, DashboardService.INACTIVE_CLIENTS_LIMIT + 5)
            .mapToObj(
                i ->
                    (ClientRepository.InactiveClientRow)
                        new Row(
                            (long) i,
                            "Client " + i,
                            "098100" + i,
                            daysAgo(DashboardService.INACTIVE_CLIENT_THRESHOLD_DAYS + i)))
            .toList();
    when(clientRepository.findActiveClientsWithLastCompletedVisit(
            eq(1L), eq(AppointmentStatus.COMPLETED)))
        .thenReturn(rows);

    DashboardResponse d = dashboardService.build(1L);

    assertThat(d.inactiveClients()).hasSize(DashboardService.INACTIVE_CLIENTS_LIMIT);
  }

  /** Issue #216 follow-up: "Ver todas" full paginated list — unlike the widget, not capped to N. */
  @Test
  void pagedListExcludesNeverVisitedAndReturnsEveryoneAcrossPages() {
    List<ClientRepository.InactiveClientRow> rows =
        java.util.stream.IntStream.rangeClosed(1, 21)
            .mapToObj(
                i ->
                    (ClientRepository.InactiveClientRow)
                        new Row((long) i, "Client " + i, "098100" + i, daysAgo(1000 + i)))
            .collect(java.util.stream.Collectors.toCollection(java.util.ArrayList::new));
    rows.add(new Row(99L, "Never Visited", "0981099999", null));
    when(clientRepository.findActiveClientsWithLastCompletedVisit(
            eq(1L), eq(AppointmentStatus.COMPLETED)))
        .thenReturn(rows);

    var page0 = dashboardService.buildInactiveClientsPage(1L, 0, 10);
    assertThat(page0.content()).hasSize(10);
    assertThat(page0.totalElements()).isEqualTo(21);
    assertThat(page0.totalPages()).isEqualTo(3);
    // Most inactive (Client 21, 1021 days ago) sorts first.
    assertThat(page0.content().get(0).fullName()).isEqualTo("Client 21");

    var page2 = dashboardService.buildInactiveClientsPage(1L, 2, 10);
    assertThat(page2.content()).hasSize(1);
    assertThat(page2.content().get(0).fullName()).isEqualTo("Client 1");
  }
}
