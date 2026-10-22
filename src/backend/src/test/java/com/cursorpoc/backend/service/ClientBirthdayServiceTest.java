package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.Client;
import com.cursorpoc.backend.repository.ClientRepository;
import com.cursorpoc.backend.web.dto.ClientBirthdaysResponse;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

/** HU-69 — dashboard birthday alerts. */
@ExtendWith(MockitoExtension.class)
class ClientBirthdayServiceTest {

  // 2026-10-21 12:00 in America/Asuncion.
  private static final Instant NOW = Instant.parse("2026-10-21T15:00:00Z");

  @Mock private ClientRepository clientRepository;

  private static Client client(long id, String name, int day, int month, Integer year) {
    Client c = new Client();
    c.setId(id);
    c.setFullName(name);
    c.setPhone("0981" + id);
    c.setActive(true);
    c.setBirthdayDay(day);
    c.setBirthdayMonth(month);
    c.setBirthdayYear(year);
    return c;
  }

  @Test
  void splitsTodayAndNextSevenDaysSortedByDate() {
    when(clientRepository.findByTenant_IdAndActiveTrueAndBirthdayMonthIsNotNull(1L))
        .thenReturn(
            List.of(
                client(1, "ZOE", 21, 10, 1990),
                client(2, "ANA", 21, 10, null),
                client(3, "EVA", 28, 10, null),
                client(4, "LIA", 29, 10, null),
                client(5, "MIA", 24, 10, 2000),
                client(6, "OLD", 20, 10, null)));
    var service =
        new ClientBirthdayService(
            clientRepository, new FemmeTimeProperties(), Clock.fixed(NOW, ZoneOffset.UTC));

    ClientBirthdaysResponse res = service.birthdays(1L);

    assertThat(res.today())
        .extracting(ClientBirthdaysResponse.Birthday::fullName)
        .containsExactly("ANA", "ZOE");
    assertThat(res.today().get(1).turningAge()).isEqualTo(36);
    assertThat(res.today().get(0).turningAge()).isNull();
    assertThat(res.upcoming())
        .extracting(ClientBirthdaysResponse.Birthday::fullName)
        .containsExactly("MIA", "EVA");
    assertThat(res.upcoming().get(0).date()).isEqualTo("2026-10-24");
    assertThat(res.upcomingDays()).isEqualTo(7);
  }
}
