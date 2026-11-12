package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.Client;
import com.cursorpoc.backend.domain.Professional;
import com.cursorpoc.backend.domain.SalonService;
import com.cursorpoc.backend.domain.ServiceRecord;
import com.cursorpoc.backend.domain.ServiceRecordLine;
import com.cursorpoc.backend.domain.enums.ServiceKind;
import com.cursorpoc.backend.domain.enums.ServiceRecordStatus;
import com.cursorpoc.backend.repository.ClientRepository;
import com.cursorpoc.backend.repository.ServiceRecordRepository;
import com.cursorpoc.backend.web.dto.ClientSummaryResponse;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.web.server.ResponseStatusException;

/** HU-67 — unit coverage of {@link ClientSummaryService}. */
@ExtendWith(MockitoExtension.class)
class ClientSummaryServiceTest {

  private static final long TENANT = 1L;
  private static final long CLIENT = 10L;
  private static final Instant NOW = Instant.parse("2026-10-21T15:00:00Z");

  @Mock private ClientRepository clientRepository;
  @Mock private ServiceRecordRepository serviceRecordRepository;

  private ClientSummaryService service;
  private final List<ServiceRecord> records = new ArrayList<>();
  private final AtomicLong ids = new AtomicLong(1);

  @BeforeEach
  void setUp() {
    FemmeTimeProperties time = new FemmeTimeProperties();
    service =
        new ClientSummaryService(
            clientRepository, serviceRecordRepository, time, Clock.fixed(NOW, ZoneOffset.UTC));
    when(clientRepository.findByIdAndTenant_Id(CLIENT, TENANT))
        .thenReturn(Optional.of(new Client()));
    lenient()
        .when(
            serviceRecordRepository.findByTenantAndClientAndStatusWithLines(
                TENANT, CLIENT, ServiceRecordStatus.CLOSED))
        .thenReturn(records);
  }

  private static Professional prof(long id, String name, boolean active) {
    Professional p = new Professional();
    p.setId(id);
    p.setFullName(name);
    p.setActive(active);
    return p;
  }

  private static SalonService item(String name, ServiceKind kind) {
    SalonService s = new SalonService();
    s.setName(name);
    s.setKind(kind);
    return s;
  }

  private void record(long daysAgo, long total, Object[]... lines) {
    ServiceRecord r = new ServiceRecord();
    r.setId(ids.incrementAndGet());
    r.setStatus(ServiceRecordStatus.CLOSED);
    r.setCreatedAt(NOW.minus(daysAgo, ChronoUnit.DAYS));
    r.setClosedAt(NOW.minus(daysAgo, ChronoUnit.DAYS));
    r.setTotalAmount(BigDecimal.valueOf(total));
    for (Object[] l : lines) {
      ServiceRecordLine line = new ServiceRecordLine();
      line.setId(ids.incrementAndGet());
      line.setServiceRecord(r);
      line.setSalonService((SalonService) l[0]);
      line.setProfessional((Professional) l[1]);
      line.setUnitPrice(BigDecimal.valueOf((Long) l[2]));
      line.setQuantity((Integer) l[3]);
      r.getLines().add(line);
    }
    records.add(r);
  }

  private static Object[] line(SalonService s, Professional p, long price, int qty) {
    return new Object[] {s, p, price, qty};
  }

  @Test
  void emptyHistory() {
    ClientSummaryResponse res = service.getSummary(TENANT, CLIENT);
    assertThat(res.usualProfessionals()).isEmpty();
    assertThat(res.lastVisitAt()).isNull();
    assertThat(res.spentLast12Months()).isNull();
    assertThat(res.averageTicketLast12Months()).isNull();
    assertThat(res.lastServices()).isEmpty();
    assertThat(res.lastProducts()).isEmpty();
  }

  @Test
  void usualProfessionalCountsOnlyServicesInsideTheWindowAndReturnsTiesAlphabetically() {
    Professional zoe = prof(1, "ZOE", true);
    Professional ana = prof(2, "ANA", false);
    Professional old = prof(3, "OLD", true);
    SalonService cut = item("Corte", ServiceKind.SERVICE);
    SalonService shampoo = item("Shampoo", ServiceKind.PRODUCT);
    record(10, 100, line(cut, zoe, 100L, 1));
    record(20, 100, line(cut, ana, 100L, 1), line(shampoo, ana, 50L, 3));
    // Outside the 12-month window: 3 services for OLD do not make her the usual one.
    record(400, 300, line(cut, old, 100L, 1), line(cut, old, 100L, 1), line(cut, old, 100L, 1));

    ClientSummaryResponse res = service.getSummary(TENANT, CLIENT);

    assertThat(res.usualProfessionals())
        .extracting(ClientSummaryResponse.UsualProfessional::fullName)
        .containsExactly("ANA", "ZOE");
    assertThat(res.usualProfessionals().get(0).active()).isFalse();
    assertThat(res.usualProfessionals().get(0).serviceCount()).isEqualTo(1);
    // Last services have no window: the old ones still show, newest first, capped at 5.
    assertThat(res.lastServices()).hasSize(5);
    assertThat(res.lastServices().get(0).professionalName()).isEqualTo("ZOE");
    assertThat(res.lastVisitAt()).isEqualTo(NOW.minus(10, ChronoUnit.DAYS));
    assertThat(res.lastProducts()).hasSize(1);
    assertThat(res.lastProducts().get(0).quantity()).isEqualTo(3);
    assertThat(res.lastProducts().get(0).unitPrice()).isEqualByComparingTo("50");
    // Spend/average only over the two in-window records.
    assertThat(res.spentLast12Months()).isEqualByComparingTo("200");
    assertThat(res.averageTicketLast12Months()).isEqualByComparingTo("100");
  }

  @Test
  void radiographyRanksServicesAndProfessionalsOverTheWholeHistory() {
    Professional laura = prof(1, "Laura", true);
    Professional ana = prof(2, "Ana", true);
    SalonService color = item("Coloración", ServiceKind.SERVICE);
    SalonService cut = item("Corte", ServiceKind.SERVICE);
    SalonService shampoo = item("Shampoo", ServiceKind.PRODUCT);
    record(10, 100, line(color, laura, 100L, 1), line(shampoo, laura, 50L, 1));
    record(30, 100, line(color, laura, 100L, 1), line(cut, ana, 100L, 1));
    // Old visits still count: the radiography looks at the whole history.
    record(500, 100, line(cut, ana, 100L, 1), line(cut, ana, 100L, 1));

    ClientSummaryResponse res = service.getSummary(TENANT, CLIENT);

    assertThat(res.topServices())
        .extracting(ClientSummaryResponse.TopService::serviceName)
        .containsExactly("Corte", "Coloración");
    assertThat(res.topServices().get(0).count()).isEqualTo(3);
    assertThat(res.topServices().get(1).count()).isEqualTo(2);
    // Products never count as services.
    assertThat(res.topServices())
        .extracting(ClientSummaryResponse.TopService::serviceName)
        .doesNotContain("Shampoo");
    assertThat(res.professionalRanking())
        .extracting(ClientSummaryResponse.ProfessionalRank::fullName)
        .containsExactly("Ana", "Laura");
    assertThat(res.professionalRanking().get(0).serviceCount()).isEqualTo(3);
  }

  @Test
  void emptyHistoryHasEmptyRadiography() {
    ClientSummaryResponse res = service.getSummary(TENANT, CLIENT);
    assertThat(res.topServices()).isEmpty();
    assertThat(res.professionalRanking()).isEmpty();
  }

  @Test
  void unknownClientIs404() {
    when(clientRepository.findByIdAndTenant_Id(CLIENT, TENANT)).thenReturn(Optional.empty());
    assertThatThrownBy(() -> service.getSummary(TENANT, CLIENT))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("CLIENT_NOT_FOUND");
  }
}
