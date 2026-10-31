package com.cursorpoc.backend.service;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.Professional;
import com.cursorpoc.backend.domain.ServiceRecord;
import com.cursorpoc.backend.domain.ServiceRecordLine;
import com.cursorpoc.backend.domain.enums.ServiceKind;
import com.cursorpoc.backend.domain.enums.ServiceRecordStatus;
import com.cursorpoc.backend.repository.ClientRepository;
import com.cursorpoc.backend.repository.ServiceRecordRepository;
import com.cursorpoc.backend.web.dto.ClientSummaryResponse;
import com.cursorpoc.backend.web.dto.ClientSummaryResponse.ProductItem;
import com.cursorpoc.backend.web.dto.ClientSummaryResponse.ProfessionalRank;
import com.cursorpoc.backend.web.dto.ClientSummaryResponse.ServiceItem;
import com.cursorpoc.backend.web.dto.ClientSummaryResponse.TopService;
import com.cursorpoc.backend.web.dto.ClientSummaryResponse.UsualProfessional;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** HU-67: aggregates a client's CLOSED service records into the profile summary. */
@Service
public class ClientSummaryService {

  static final int LAST_ITEMS_LIMIT = 5;
  static final int RANKING_LIMIT = 5;
  static final int USUAL_PROFESSIONAL_WINDOW_MONTHS = 12;

  private final ClientRepository clientRepository;
  private final ServiceRecordRepository serviceRecordRepository;
  private final FemmeTimeProperties timeProperties;
  private final Clock clock;

  @Autowired
  public ClientSummaryService(
      ClientRepository clientRepository,
      ServiceRecordRepository serviceRecordRepository,
      FemmeTimeProperties timeProperties) {
    this(clientRepository, serviceRecordRepository, timeProperties, Clock.systemUTC());
  }

  ClientSummaryService(
      ClientRepository clientRepository,
      ServiceRecordRepository serviceRecordRepository,
      FemmeTimeProperties timeProperties,
      Clock clock) {
    this.clientRepository = clientRepository;
    this.serviceRecordRepository = serviceRecordRepository;
    this.timeProperties = timeProperties;
    this.clock = clock;
  }

  @Transactional(readOnly = true)
  public ClientSummaryResponse getSummary(long tenantId, long clientId) {
    clientRepository
        .findByIdAndTenant_Id(clientId, tenantId)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "CLIENT_NOT_FOUND"));

    List<ServiceRecord> records =
        serviceRecordRepository.findByTenantAndClientAndStatusWithLines(
            tenantId, clientId, ServiceRecordStatus.CLOSED);

    // Window: from the same day 12 months ago (start of day, server zone) up to now.
    var zone = timeProperties.zoneId();
    LocalDate today = LocalDate.now(clock.withZone(zone));
    Instant windowStart =
        today.minusMonths(USUAL_PROFESSIONAL_WINDOW_MONTHS).atStartOfDay(zone).toInstant();

    Comparator<ServiceRecordLine> newestFirst =
        Comparator.comparing((ServiceRecordLine l) -> performedAt(l.getServiceRecord()))
            .thenComparing(ServiceRecordLine::getId)
            .reversed();

    List<ServiceRecordLine> serviceLines =
        records.stream()
            .flatMap(r -> r.getLines().stream())
            .filter(l -> l.getSalonService().getKind() == ServiceKind.SERVICE)
            .sorted(newestFirst)
            .toList();
    List<ServiceRecordLine> productLines =
        records.stream()
            .flatMap(r -> r.getLines().stream())
            .filter(l -> l.getSalonService().getKind() == ServiceKind.PRODUCT)
            .sorted(newestFirst)
            .toList();

    Instant lastVisitAt =
        serviceLines.isEmpty() ? null : performedAt(serviceLines.get(0).getServiceRecord());

    List<ServiceRecord> inWindow =
        records.stream().filter(r -> !performedAt(r).isBefore(windowStart)).toList();
    BigDecimal spent = null;
    BigDecimal averageTicket = null;
    if (!inWindow.isEmpty()) {
      spent =
          inWindow.stream()
              .map(ServiceRecord::getTotalAmount)
              .reduce(BigDecimal.ZERO, BigDecimal::add);
      averageTicket = spent.divide(BigDecimal.valueOf(inWindow.size()), 0, RoundingMode.HALF_UP);
    }

    return new ClientSummaryResponse(
        usualProfessionals(serviceLines, windowStart),
        lastVisitAt,
        spent,
        averageTicket,
        serviceLines.stream().limit(LAST_ITEMS_LIMIT).map(ClientSummaryService::toService).toList(),
        productLines.stream().limit(LAST_ITEMS_LIMIT).map(ClientSummaryService::toProduct).toList(),
        topServices(serviceLines),
        professionalRanking(serviceLines));
  }

  /** Services the client gets most often (all closed visits); ties A→Z. */
  private static List<TopService> topServices(List<ServiceRecordLine> serviceLines) {
    Map<String, Integer> counts = new LinkedHashMap<>();
    for (ServiceRecordLine line : serviceLines) {
      counts.merge(line.getSalonService().getName(), quantity(line), Integer::sum);
    }
    return counts.entrySet().stream()
        .sorted(
            Comparator.comparing((Map.Entry<String, Integer> e) -> e.getValue())
                .reversed()
                .thenComparing(Map.Entry::getKey, String.CASE_INSENSITIVE_ORDER))
        .limit(RANKING_LIMIT)
        .map(e -> new TopService(e.getKey(), e.getValue()))
        .toList();
  }

  /** Professionals who attend the client, most services first; ties A→Z. */
  private static List<ProfessionalRank> professionalRanking(List<ServiceRecordLine> serviceLines) {
    Map<Long, Professional> byId = new HashMap<>();
    Map<Long, Integer> counts = new HashMap<>();
    for (ServiceRecordLine line : serviceLines) {
      Professional p = line.getProfessional();
      if (p == null) {
        continue;
      }
      byId.put(p.getId(), p);
      counts.merge(p.getId(), 1, Integer::sum);
    }
    return counts.entrySet().stream()
        .sorted(
            Comparator.comparing((Map.Entry<Long, Integer> e) -> e.getValue())
                .reversed()
                .thenComparing(
                    e -> byId.get(e.getKey()).getFullName(), String.CASE_INSENSITIVE_ORDER))
        .limit(RANKING_LIMIT)
        .map(
            e -> {
              Professional p = byId.get(e.getKey());
              return new ProfessionalRank(p.getId(), p.getFullName(), p.isActive(), e.getValue());
            })
        .toList();
  }

  /** The professional(s) with the most services in the window; ties are all returned, A→Z. */
  private static List<UsualProfessional> usualProfessionals(
      List<ServiceRecordLine> serviceLines, Instant windowStart) {
    Map<Long, Professional> byId = new HashMap<>();
    Map<Long, Integer> counts = new HashMap<>();
    for (ServiceRecordLine line : serviceLines) {
      Professional p = line.getProfessional();
      if (p == null || performedAt(line.getServiceRecord()).isBefore(windowStart)) {
        continue;
      }
      byId.put(p.getId(), p);
      counts.merge(p.getId(), 1, Integer::sum);
    }
    int max = counts.values().stream().max(Integer::compare).orElse(0);
    return counts.entrySet().stream()
        .filter(e -> e.getValue() == max)
        .map(e -> byId.get(e.getKey()))
        .sorted(Comparator.comparing(Professional::getFullName, String.CASE_INSENSITIVE_ORDER))
        .map(p -> new UsualProfessional(p.getId(), p.getFullName(), p.isActive(), max))
        .toList();
  }

  private static Instant performedAt(ServiceRecord record) {
    return record.getClosedAt() != null ? record.getClosedAt() : record.getCreatedAt();
  }

  private static ServiceItem toService(ServiceRecordLine line) {
    Professional p = line.getProfessional();
    return new ServiceItem(
        performedAt(line.getServiceRecord()),
        line.getSalonService().getName(),
        p == null ? null : p.getId(),
        p == null ? null : p.getFullName(),
        line.getUnitPrice().multiply(BigDecimal.valueOf(quantity(line))));
  }

  private static ProductItem toProduct(ServiceRecordLine line) {
    return new ProductItem(
        performedAt(line.getServiceRecord()),
        line.getSalonService().getName(),
        quantity(line),
        line.getUnitPrice());
  }

  private static int quantity(ServiceRecordLine line) {
    return line.getQuantity() == null ? 1 : line.getQuantity();
  }
}
