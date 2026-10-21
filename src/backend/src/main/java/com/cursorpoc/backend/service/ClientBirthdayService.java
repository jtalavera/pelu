package com.cursorpoc.backend.service;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.Client;
import com.cursorpoc.backend.domain.ClientBirthday;
import com.cursorpoc.backend.repository.ClientRepository;
import com.cursorpoc.backend.web.dto.ClientBirthdaysResponse;
import com.cursorpoc.backend.web.dto.ClientBirthdaysResponse.Birthday;
import java.time.Clock;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** HU-69: "who has a birthday today / this week" for the main dashboard. Active clients only. */
@Service
public class ClientBirthdayService {

  static final int UPCOMING_DAYS = 7;

  private final ClientRepository clientRepository;
  private final FemmeTimeProperties timeProperties;
  private final Clock clock;

  @Autowired
  public ClientBirthdayService(
      ClientRepository clientRepository, FemmeTimeProperties timeProperties) {
    this(clientRepository, timeProperties, Clock.systemUTC());
  }

  ClientBirthdayService(
      ClientRepository clientRepository, FemmeTimeProperties timeProperties, Clock clock) {
    this.clientRepository = clientRepository;
    this.timeProperties = timeProperties;
    this.clock = clock;
  }

  @Transactional(readOnly = true)
  public ClientBirthdaysResponse birthdays(long tenantId) {
    LocalDate today = LocalDate.now(clock.withZone(timeProperties.zoneId()));
    LocalDate last = today.plusDays(UPCOMING_DAYS);
    List<Birthday> todayList = new ArrayList<>();
    List<Birthday> upcoming = new ArrayList<>();
    List<Client> clients =
        clientRepository.findByTenant_IdAndActiveTrueAndBirthdayMonthIsNotNull(tenantId);
    clients.stream()
        .filter(c -> c.getBirthdayDay() != null)
        .map(c -> toBirthday(c, today))
        .filter(b -> !LocalDate.parse(b.date()).isAfter(last))
        .sorted(
            Comparator.comparing(Birthday::date)
                .thenComparing(Birthday::fullName, String.CASE_INSENSITIVE_ORDER))
        .forEach(b -> (b.date().equals(today.toString()) ? todayList : upcoming).add(b));
    return new ClientBirthdaysResponse(todayList, upcoming, UPCOMING_DAYS);
  }

  private static Birthday toBirthday(Client c, LocalDate today) {
    LocalDate next = ClientBirthday.nextOccurrence(c.getBirthdayDay(), c.getBirthdayMonth(), today);
    Integer age = c.getBirthdayYear() == null ? null : next.getYear() - c.getBirthdayYear();
    return new Birthday(c.getId(), c.getFullName(), c.getPhone(), next.toString(), age);
  }
}
