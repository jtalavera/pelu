package com.cursorpoc.backend.service;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.Client;
import com.cursorpoc.backend.domain.Invoice;
import com.cursorpoc.backend.domain.Professional;
import com.cursorpoc.backend.domain.SalonService;
import com.cursorpoc.backend.domain.ServiceRecord;
import com.cursorpoc.backend.domain.ServiceRecordLine;
import com.cursorpoc.backend.domain.ServiceRecordTip;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.enums.ServiceRecordStatus;
import com.cursorpoc.backend.repository.ClientRepository;
import com.cursorpoc.backend.repository.InvoiceRepository;
import com.cursorpoc.backend.repository.ProfessionalRepository;
import com.cursorpoc.backend.repository.SalonServiceRepository;
import com.cursorpoc.backend.repository.ServiceRecordRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.web.dto.PagedServiceRecordsResponse;
import com.cursorpoc.backend.web.dto.ServiceRecordLineRequest;
import com.cursorpoc.backend.web.dto.ServiceRecordLineResponse;
import com.cursorpoc.backend.web.dto.ServiceRecordListItemResponse;
import com.cursorpoc.backend.web.dto.ServiceRecordRequest;
import com.cursorpoc.backend.web.dto.ServiceRecordResponse;
import com.cursorpoc.backend.web.dto.ServiceRecordTipRequest;
import com.cursorpoc.backend.web.dto.ServiceRecordTipResponse;
import com.cursorpoc.backend.web.dto.ServiceRecordVoidRequest;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.BiFunction;
import java.util.stream.Collectors;
import org.hibernate.Hibernate;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class ServiceRecordService {

  /** Maximum inclusive calendar months that date filters may span (mirrors invoice history). */
  public static final int MAX_LIST_MONTHS = 6;

  private final ServiceRecordRepository serviceRecordRepository;
  private final ClientRepository clientRepository;
  private final ProfessionalRepository professionalRepository;
  private final SalonServiceRepository salonServiceRepository;
  private final TenantRepository tenantRepository;
  private final InvoiceRepository invoiceRepository;
  private final FemmeTimeProperties timeProperties;

  public ServiceRecordService(
      ServiceRecordRepository serviceRecordRepository,
      ClientRepository clientRepository,
      ProfessionalRepository professionalRepository,
      SalonServiceRepository salonServiceRepository,
      TenantRepository tenantRepository,
      InvoiceRepository invoiceRepository,
      FemmeTimeProperties timeProperties) {
    this.serviceRecordRepository = serviceRecordRepository;
    this.clientRepository = clientRepository;
    this.professionalRepository = professionalRepository;
    this.salonServiceRepository = salonServiceRepository;
    this.tenantRepository = tenantRepository;
    this.invoiceRepository = invoiceRepository;
    this.timeProperties = timeProperties;
  }

  @Transactional
  public ServiceRecordResponse createServiceRecord(long tenantId, ServiceRecordRequest request) {
    Tenant tenant =
        tenantRepository
            .findById(tenantId)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "TENANT_NOT_FOUND"));
    Client client = requireClient(tenantId, request.clientId());

    ServiceRecord record = new ServiceRecord();
    record.setTenant(tenant);
    record.setClient(client);
    record.setStatus(ServiceRecordStatus.OPEN);
    record.setCreatedAt(Instant.now());

    applyLinesAndTips(record, request, tenantId);

    serviceRecordRepository.save(record);
    return toDetailDto(record, null);
  }

  @Transactional
  public ServiceRecordResponse updateServiceRecord(
      long tenantId, long id, ServiceRecordRequest request) {
    ServiceRecord record = requireOpenServiceRecord(tenantId, id);
    Client client = requireClient(tenantId, request.clientId());
    record.setClient(client);

    Hibernate.initialize(record.getLines());
    Hibernate.initialize(record.getTips());
    record.getLines().clear();
    applyLinesAndTips(record, request, tenantId);

    return toDetailDto(record, null);
  }

  @Transactional
  public ServiceRecordResponse voidServiceRecord(
      long tenantId, long id, ServiceRecordVoidRequest request) {
    ServiceRecord record = requireOpenServiceRecord(tenantId, id);
    record.setStatus(ServiceRecordStatus.VOIDED);
    record.setVoidReason(request.voidReason().trim());
    return toDetailDto(record, null);
  }

  @Transactional(readOnly = true)
  public ServiceRecordResponse getServiceRecord(long tenantId, long id) {
    ServiceRecord record =
        serviceRecordRepository
            .findByIdAndTenant_Id(id, tenantId)
            .orElseThrow(
                () ->
                    new ResponseStatusException(HttpStatus.NOT_FOUND, "SERVICE_RECORD_NOT_FOUND"));
    Hibernate.initialize(record.getLines());
    Hibernate.initialize(record.getTips());
    Invoice linkedInvoice = invoiceRepository.findByServiceRecord_Id(id).orElse(null);
    return toDetailDto(record, linkedInvoice);
  }

  @Transactional(readOnly = true)
  public PagedServiceRecordsResponse listServiceRecords(
      long tenantId,
      Instant fromDate,
      Instant toDate,
      Long clientId,
      String statusStr,
      String q,
      int page,
      int size) {
    Instant[] fromTo = resolveListRange(fromDate, toDate);
    ServiceRecordStatus status = null;
    if (statusStr != null && !statusStr.isBlank()) {
      try {
        status = ServiceRecordStatus.valueOf(statusStr.toUpperCase());
      } catch (IllegalArgumentException e) {
        // ignore bad status filter
      }
    }
    String qTrimmed = (q != null && !q.isBlank()) ? q.trim() : null;
    Pageable pageable = PageRequest.of(page, Math.max(1, Math.min(size, 200)));
    Page<ServiceRecord> recordPage =
        serviceRecordRepository.findByTenantWithFiltersPaged(
            tenantId, fromTo[0], fromTo[1], clientId, status, qTrimmed, pageable);
    List<ServiceRecordListItemResponse> content =
        recordPage.getContent().stream()
            .map(ServiceRecordService::toListItemDto)
            .collect(Collectors.toList());
    return new PagedServiceRecordsResponse(
        content,
        recordPage.getNumber(),
        recordPage.getSize(),
        recordPage.getTotalElements(),
        recordPage.getTotalPages());
  }

  // ── Professional view (Inicio de la profesional / dispositivo compartido) ──────────────────
  //
  // A professional sees every OPEN ficha of today (the salon's business day) and may add, change
  // and remove services and quantities. She never sees or sets money: amounts come back null, new
  // lines take the catalog price (a kept service keeps the price it already had) and tips are not
  // touched.

  /** Every OPEN ficha created today, newest first, without amounts. */
  @Transactional(readOnly = true)
  public List<ServiceRecordListItemResponse> listOpenTodayForProfessional(long tenantId) {
    Instant[] today = businessDayRange();
    Page<ServiceRecord> recordPage =
        serviceRecordRepository.findByTenantWithFiltersPaged(
            tenantId,
            today[0],
            today[1],
            null,
            ServiceRecordStatus.OPEN,
            null,
            PageRequest.of(0, 200));
    return recordPage.getContent().stream()
        .map(ServiceRecordService::toListItemDto)
        .map(ServiceRecordService::withoutAmounts)
        .collect(Collectors.toList());
  }

  /** An OPEN ficha of today, without amounts; anything else is "not found" for a professional. */
  @Transactional(readOnly = true)
  public ServiceRecordResponse getOpenTodayForProfessional(long tenantId, long id) {
    ServiceRecord record = requireOpenTodayRecord(tenantId, id);
    Hibernate.initialize(record.getLines());
    Hibernate.initialize(record.getTips());
    return withoutAmounts(toDetailDto(record, null));
  }

  /**
   * Replaces the ficha's services (service, professional, quantity). The client, prices and tips
   * sent in the request are ignored: a kept service keeps its price, a new one takes the catalog
   * price, and a tip is dropped only when its professional no longer appears in any line. A line
   * sent without a professional belongs to the professional who is editing.
   */
  @Transactional
  public ServiceRecordResponse updateServicesAsProfessional(
      long tenantId, long id, ServiceRecordRequest request, Long professionalId) {
    ServiceRecord record = requireOpenTodayRecord(tenantId, id);
    Hibernate.initialize(record.getLines());
    Hibernate.initialize(record.getTips());

    Map<Long, Deque<BigDecimal>> keptPrices = new LinkedHashMap<>();
    for (ServiceRecordLine existing : record.getLines()) {
      keptPrices
          .computeIfAbsent(existing.getSalonService().getId(), k -> new ArrayDeque<>())
          .add(existing.getUnitPrice());
    }
    BiFunction<ServiceRecordLineRequest, SalonService, BigDecimal> priceFor =
        (lr, service) -> {
          Deque<BigDecimal> kept = keptPrices.get(service.getId());
          if (kept != null && !kept.isEmpty()) {
            return kept.poll();
          }
          return service.getPriceMinor() != null ? service.getPriceMinor() : BigDecimal.ZERO;
        };

    // A line without a professional is hers (she never has to pick one).
    List<ServiceRecordLineRequest> requested =
        request.lines().stream()
            .map(
                lr ->
                    lr.professionalId() == null && professionalId != null
                        ? new ServiceRecordLineRequest(
                            lr.serviceId(), professionalId, lr.quantity(), lr.unitPrice())
                        : lr)
            .collect(Collectors.toList());

    record.getLines().clear();
    Set<Long> lineProfessionalIds = applyLines(record, requested, tenantId, priceFor);
    record.getTips().removeIf(t -> !lineProfessionalIds.contains(t.getProfessional().getId()));
    return withoutAmounts(toDetailDto(record, null));
  }

  private ServiceRecord requireOpenTodayRecord(long tenantId, long id) {
    ServiceRecord record = requireOpenServiceRecord(tenantId, id);
    Instant[] today = businessDayRange();
    if (record.getCreatedAt().isBefore(today[0]) || record.getCreatedAt().isAfter(today[1])) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "SERVICE_RECORD_NOT_FOUND");
    }
    return record;
  }

  /** [start, end] of today in the salon's business time zone. */
  private Instant[] businessDayRange() {
    ZoneId zone = timeProperties.zoneId();
    LocalDate today = LocalDate.now(zone);
    return new Instant[] {
      today.atStartOfDay(zone).toInstant(),
      today.plusDays(1).atStartOfDay(zone).toInstant().minusMillis(1)
    };
  }

  /** What a professional may see of a ficha / list item: no money. */
  public static ServiceRecordResponse maskAmounts(ServiceRecordResponse r) {
    return withoutAmounts(r);
  }

  public static ServiceRecordListItemResponse maskAmounts(ServiceRecordListItemResponse r) {
    return withoutAmounts(r);
  }

  private static ServiceRecordListItemResponse withoutAmounts(ServiceRecordListItemResponse r) {
    return new ServiceRecordListItemResponse(
        r.id(),
        r.clientId(),
        r.clientFullName(),
        r.status(),
        null,
        r.createdAt(),
        r.servicesSummary(),
        r.professionalsSummary(),
        r.appointmentId(),
        r.appointmentStartAt());
  }

  private static ServiceRecordResponse withoutAmounts(ServiceRecordResponse r) {
    List<ServiceRecordLineResponse> lines =
        r.lines().stream()
            .map(
                l ->
                    new ServiceRecordLineResponse(
                        l.id(),
                        l.serviceId(),
                        l.description(),
                        null,
                        l.quantity(),
                        null,
                        l.professionalId(),
                        l.professionalName()))
            .collect(Collectors.toList());
    return new ServiceRecordResponse(
        r.id(),
        r.clientId(),
        r.clientFullName(),
        null,
        r.status(),
        null,
        null,
        r.voidReason(),
        r.createdAt(),
        r.closedAt(),
        r.invoiceId(),
        r.invoiceNumberFormatted(),
        lines,
        List.of(),
        r.appointmentId(),
        r.appointmentStartAt());
  }

  static Instant[] resolveListRange(Instant from, Instant to) {
    ZoneId zone = ZoneId.systemDefault();
    if (from == null && to == null) {
      LocalDate today = LocalDate.now(zone);
      Instant start = today.minusMonths(MAX_LIST_MONTHS).atStartOfDay(zone).toInstant();
      Instant end = today.atTime(LocalTime.of(23, 59, 59, 999_000_000)).atZone(zone).toInstant();
      return new Instant[] {start, end};
    }
    if (from == null || to == null) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "SERVICE_RECORD_LIST_RANGE_INCOMPLETE");
    }
    if (from.isAfter(to)) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "SERVICE_RECORD_LIST_INVALID_RANGE");
    }
    Instant sixMonthsAgo =
        LocalDate.now(zone).minusMonths(MAX_LIST_MONTHS).atStartOfDay(zone).toInstant();
    if (from.isBefore(sixMonthsAgo)) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "SERVICE_RECORD_LIST_RANGE_TOO_OLD");
    }
    return new Instant[] {from, to};
  }

  private Client requireClient(long tenantId, Long clientId) {
    return clientRepository
        .findByIdAndTenant_Id(clientId, tenantId)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "CLIENT_NOT_FOUND"));
  }

  private ServiceRecord requireOpenServiceRecord(long tenantId, long id) {
    ServiceRecord record =
        serviceRecordRepository
            .findByIdAndTenant_Id(id, tenantId)
            .orElseThrow(
                () ->
                    new ResponseStatusException(HttpStatus.NOT_FOUND, "SERVICE_RECORD_NOT_FOUND"));
    if (record.getStatus() != ServiceRecordStatus.OPEN) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "SERVICE_RECORD_NOT_OPEN");
    }
    return record;
  }

  private void applyLinesAndTips(
      ServiceRecord record, ServiceRecordRequest request, long tenantId) {
    Map<Long, Professional> professionalsById = new LinkedHashMap<>();
    Set<Long> lineProfessionalIds =
        applyLines(
            record,
            request.lines(),
            tenantId,
            (lr, service) -> lr.unitPrice() != null ? lr.unitPrice() : BigDecimal.ZERO,
            professionalsById);
    reconcileTips(record, request, lineProfessionalIds, professionalsById);
  }

  private Set<Long> applyLines(
      ServiceRecord record,
      List<ServiceRecordLineRequest> lines,
      long tenantId,
      BiFunction<ServiceRecordLineRequest, SalonService, BigDecimal> priceFor) {
    return applyLines(record, lines, tenantId, priceFor, new LinkedHashMap<>());
  }

  /** Builds the ficha's lines and total; returns the ids of the professionals on its lines. */
  private Set<Long> applyLines(
      ServiceRecord record,
      List<ServiceRecordLineRequest> lines,
      long tenantId,
      BiFunction<ServiceRecordLineRequest, SalonService, BigDecimal> priceFor,
      Map<Long, Professional> professionalsById) {
    BigDecimal total = BigDecimal.ZERO;
    Set<Long> lineProfessionalIds = new LinkedHashSet<>();
    for (ServiceRecordLineRequest lr : lines) {
      if (lr.quantity() != null && lr.quantity() < 1) {
        throw new ResponseStatusException(
            HttpStatus.BAD_REQUEST, "SERVICE_RECORD_LINE_QUANTITY_INVALID");
      }
      if (lr.unitPrice() != null && lr.unitPrice().compareTo(BigDecimal.ZERO) <= 0) {
        throw new ResponseStatusException(
            HttpStatus.BAD_REQUEST, "SERVICE_RECORD_LINE_UNIT_PRICE_INVALID");
      }
      SalonService salonService =
          salonServiceRepository
              .findByIdAndTenant_Id(lr.serviceId(), tenantId)
              .orElseThrow(
                  () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "SERVICE_NOT_FOUND"));
      Professional professional =
          lr.professionalId() != null
              ? professionalRepository
                  .findByIdAndTenant_Id(lr.professionalId(), tenantId)
                  .orElseThrow(
                      () ->
                          new ResponseStatusException(
                              HttpStatus.NOT_FOUND, "PROFESSIONAL_NOT_FOUND"))
              : null;

      ServiceRecordLine line = new ServiceRecordLine();
      line.setServiceRecord(record);
      line.setSalonService(salonService);
      line.setProfessional(professional);
      line.setDescription(salonService.getName());
      int quantity = lr.quantity() != null ? lr.quantity() : 1;
      BigDecimal unitPrice = priceFor.apply(lr, salonService).setScale(2, RoundingMode.HALF_UP);
      line.setUnitPrice(unitPrice);
      line.setQuantity(quantity);
      record.getLines().add(line);

      total = total.add(unitPrice.multiply(BigDecimal.valueOf(quantity)));
      if (professional != null) {
        lineProfessionalIds.add(professional.getId());
        professionalsById.put(professional.getId(), professional);
      }
    }
    record.setTotalAmount(total.setScale(2, RoundingMode.HALF_UP));
    return lineProfessionalIds;
  }

  /**
   * Updates/adds/removes tip rows to match the request, reusing existing {@link ServiceRecordTip}
   * entities for professionals that remain present. A blind clear-then-recreate would momentarily
   * re-insert a row for a professional whose old tip row hasn't been deleted yet, violating the
   * DB's unique (service_record_id, professional_id) constraint — this is why edits to an
   * already-open record could silently fail to persist.
   */
  private void reconcileTips(
      ServiceRecord record,
      ServiceRecordRequest request,
      Set<Long> lineProfessionalIds,
      Map<Long, Professional> professionalsById) {
    Map<Long, ServiceRecordTip> existingByProfessional =
        record.getTips().stream()
            .collect(Collectors.toMap(t -> t.getProfessional().getId(), t -> t));

    Set<Long> requestedProfessionalIds = new LinkedHashSet<>();
    if (request.tips() != null) {
      for (ServiceRecordTipRequest tr : request.tips()) {
        if (!lineProfessionalIds.contains(tr.professionalId())) {
          throw new ResponseStatusException(
              HttpStatus.BAD_REQUEST, "TIP_PROFESSIONAL_NOT_IN_LINES");
        }
        requestedProfessionalIds.add(tr.professionalId());
        BigDecimal amount = tr.amount().setScale(2, RoundingMode.HALF_UP);
        ServiceRecordTip existing = existingByProfessional.get(tr.professionalId());
        if (existing != null) {
          existing.setAmount(amount);
        } else {
          ServiceRecordTip tip = new ServiceRecordTip();
          tip.setServiceRecord(record);
          tip.setProfessional(professionalsById.get(tr.professionalId()));
          tip.setAmount(amount);
          record.getTips().add(tip);
        }
      }
    }
    record.getTips().removeIf(t -> !requestedProfessionalIds.contains(t.getProfessional().getId()));
  }

  /** List-item view of a ficha (used by the turno's "assign a ficha" picker). */
  ServiceRecordListItemResponse toListItem(ServiceRecord r) {
    return toListItemDto(r);
  }

  private static ServiceRecordListItemResponse toListItemDto(ServiceRecord r) {
    return new ServiceRecordListItemResponse(
        r.getId(),
        r.getClient().getId(),
        r.getClient().getFullName(),
        r.getStatus().name(),
        r.getTotalAmount(),
        r.getCreatedAt(),
        distinctJoined(r.getLines().stream().map(l -> l.getSalonService().getName())),
        distinctJoined(
            r.getLines().stream()
                .map(l -> l.getProfessional() == null ? null : l.getProfessional().getFullName())),
        r.getAppointment() != null ? r.getAppointment().getId() : null,
        r.getAppointment() != null ? r.getAppointment().getStartAt() : null);
  }

  private static String distinctJoined(java.util.stream.Stream<String> names) {
    return names
        .filter(n -> n != null && !n.isBlank())
        .distinct()
        .collect(Collectors.joining(", "));
  }

  private static ServiceRecordResponse toDetailDto(ServiceRecord r, Invoice linkedInvoice) {
    List<ServiceRecordLineResponse> lines =
        r.getLines().stream()
            .map(
                l ->
                    new ServiceRecordLineResponse(
                        l.getId(),
                        l.getSalonService().getId(),
                        l.getDescription(),
                        l.getUnitPrice(),
                        l.getQuantity(),
                        l.getUnitPrice()
                            .multiply(BigDecimal.valueOf(l.getQuantity()))
                            .setScale(2, RoundingMode.HALF_UP),
                        l.getProfessional() != null ? l.getProfessional().getId() : null,
                        l.getProfessional() != null ? l.getProfessional().getFullName() : null))
            .collect(Collectors.toList());

    List<ServiceRecordTipResponse> tips =
        r.getTips().stream()
            .map(
                t ->
                    new ServiceRecordTipResponse(
                        t.getProfessional().getId(),
                        t.getProfessional().getFullName(),
                        t.getAmount()))
            .collect(Collectors.toList());

    BigDecimal tipsTotal =
        tips.stream()
            .map(ServiceRecordTipResponse::amount)
            .reduce(BigDecimal.ZERO, BigDecimal::add);

    return new ServiceRecordResponse(
        r.getId(),
        r.getClient().getId(),
        r.getClient().getFullName(),
        r.getClient().getRuc(),
        r.getStatus().name(),
        r.getTotalAmount(),
        tipsTotal,
        r.getVoidReason(),
        r.getCreatedAt(),
        r.getClosedAt(),
        linkedInvoice != null ? linkedInvoice.getId() : null,
        linkedInvoice != null ? formatInvoiceNumber(linkedInvoice.getInvoiceNumber()) : null,
        lines,
        tips,
        r.getAppointment() != null ? r.getAppointment().getId() : null,
        r.getAppointment() != null ? r.getAppointment().getStartAt() : null);
  }

  private static String formatInvoiceNumber(int number) {
    return String.format("%07d", number);
  }
}
