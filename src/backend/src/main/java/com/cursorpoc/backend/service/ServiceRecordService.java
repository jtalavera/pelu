package com.cursorpoc.backend.service;

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
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
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

  public ServiceRecordService(
      ServiceRecordRepository serviceRecordRepository,
      ClientRepository clientRepository,
      ProfessionalRepository professionalRepository,
      SalonServiceRepository salonServiceRepository,
      TenantRepository tenantRepository,
      InvoiceRepository invoiceRepository) {
    this.serviceRecordRepository = serviceRecordRepository;
    this.clientRepository = clientRepository;
    this.professionalRepository = professionalRepository;
    this.salonServiceRepository = salonServiceRepository;
    this.tenantRepository = tenantRepository;
    this.invoiceRepository = invoiceRepository;
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
    if (request.lines() == null || request.lines().isEmpty()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "SERVICE_RECORD_LINES_REQUIRED");
    }
    BigDecimal total = BigDecimal.ZERO;
    Set<Long> lineProfessionalIds = new LinkedHashSet<>();
    Map<Long, Professional> professionalsById = new LinkedHashMap<>();
    for (ServiceRecordLineRequest lr : request.lines()) {
      if (lr.quantity() == null || lr.quantity() < 1) {
        throw new ResponseStatusException(
            HttpStatus.BAD_REQUEST, "SERVICE_RECORD_LINE_QUANTITY_INVALID");
      }
      if (lr.unitPrice() == null || lr.unitPrice().compareTo(BigDecimal.ZERO) <= 0) {
        throw new ResponseStatusException(
            HttpStatus.BAD_REQUEST, "SERVICE_RECORD_LINE_UNIT_PRICE_INVALID");
      }
      SalonService salonService =
          salonServiceRepository
              .findByIdAndTenant_Id(lr.serviceId(), tenantId)
              .orElseThrow(
                  () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "SERVICE_NOT_FOUND"));
      Professional professional =
          professionalRepository
              .findByIdAndTenant_Id(lr.professionalId(), tenantId)
              .orElseThrow(
                  () ->
                      new ResponseStatusException(HttpStatus.NOT_FOUND, "PROFESSIONAL_NOT_FOUND"));

      ServiceRecordLine line = new ServiceRecordLine();
      line.setServiceRecord(record);
      line.setSalonService(salonService);
      line.setProfessional(professional);
      line.setDescription(salonService.getName());
      BigDecimal unitPrice = lr.unitPrice().setScale(2, RoundingMode.HALF_UP);
      line.setUnitPrice(unitPrice);
      line.setQuantity(lr.quantity());
      record.getLines().add(line);

      total = total.add(unitPrice.multiply(BigDecimal.valueOf(lr.quantity())));
      lineProfessionalIds.add(professional.getId());
      professionalsById.put(professional.getId(), professional);
    }
    record.setTotalAmount(total.setScale(2, RoundingMode.HALF_UP));

    reconcileTips(record, request, lineProfessionalIds, professionalsById);
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

  private static ServiceRecordListItemResponse toListItemDto(ServiceRecord r) {
    return new ServiceRecordListItemResponse(
        r.getId(),
        r.getClient().getId(),
        r.getClient().getFullName(),
        r.getStatus().name(),
        r.getTotalAmount(),
        r.getCreatedAt());
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
                        l.getProfessional().getId(),
                        l.getProfessional().getFullName()))
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
        tips);
  }

  private static String formatInvoiceNumber(int number) {
    return String.format("%07d", number);
  }
}
