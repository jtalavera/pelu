package com.cursorpoc.backend.service;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.CashSession;
import com.cursorpoc.backend.domain.Client;
import com.cursorpoc.backend.domain.FiscalStamp;
import com.cursorpoc.backend.domain.Invoice;
import com.cursorpoc.backend.domain.InvoiceLine;
import com.cursorpoc.backend.domain.InvoicePaymentAllocation;
import com.cursorpoc.backend.domain.ServiceRecord;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.enums.ClientIdentityDocumentType;
import com.cursorpoc.backend.domain.enums.DiscountType;
import com.cursorpoc.backend.domain.enums.InvoiceStatus;
import com.cursorpoc.backend.domain.enums.PaymentMethod;
import com.cursorpoc.backend.domain.enums.ServiceRecordStatus;
import com.cursorpoc.backend.domain.enums.SifenSubmissionStatus;
import com.cursorpoc.backend.repository.BusinessProfileRepository;
import com.cursorpoc.backend.repository.CashSessionRepository;
import com.cursorpoc.backend.repository.ClientRepository;
import com.cursorpoc.backend.repository.FiscalStampRepository;
import com.cursorpoc.backend.repository.InvoiceRepository;
import com.cursorpoc.backend.repository.SalonServiceRepository;
import com.cursorpoc.backend.repository.ServiceRecordRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.web.dto.InvoiceCreateRequest;
import com.cursorpoc.backend.web.dto.InvoiceLineRequest;
import com.cursorpoc.backend.web.dto.InvoiceLineResponse;
import com.cursorpoc.backend.web.dto.InvoiceListItemResponse;
import com.cursorpoc.backend.web.dto.InvoicePaymentAllocationRequest;
import com.cursorpoc.backend.web.dto.InvoicePaymentAllocationResponse;
import com.cursorpoc.backend.web.dto.InvoiceResponse;
import com.cursorpoc.backend.web.dto.InvoiceVoidRequest;
import com.cursorpoc.backend.web.dto.PagedInvoicesResponse;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.List;
import java.util.Objects;
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
public class InvoiceService {

  private static final String OCCASIONAL_CLIENT_DISPLAY_NAME = "CONSUMIDOR FINAL";

  /**
   * SIFEN HU-02 AC-05: a general DNIT invoicing rule (not SIFEN-specific) — any sale at or above
   * this amount requires identifying the client (RUC or identity document), regardless of whether
   * the tenant issues through SIFEN or the traditional generator.
   */
  private static final BigDecimal CLIENT_IDENTIFICATION_THRESHOLD = new BigDecimal("7000000");

  /** Maximum inclusive calendar months that date filters may span (6 months = ~180 days). */
  public static final int MAX_INVOICE_LIST_MONTHS = 6;

  private final InvoiceRepository invoiceRepository;
  private final CashSessionRepository cashSessionRepository;
  private final FiscalStampRepository fiscalStampRepository;
  private final ClientRepository clientRepository;
  private final TenantRepository tenantRepository;
  private final SalonServiceRepository salonServiceRepository;
  private final BusinessProfileRepository businessProfileRepository;
  private final ServiceRecordRepository serviceRecordRepository;
  private final FemmeTimeProperties timeProperties;
  private final SifenInvoiceHeaderService sifenInvoiceHeaderService;

  public InvoiceService(
      InvoiceRepository invoiceRepository,
      CashSessionRepository cashSessionRepository,
      FiscalStampRepository fiscalStampRepository,
      ClientRepository clientRepository,
      TenantRepository tenantRepository,
      SalonServiceRepository salonServiceRepository,
      BusinessProfileRepository businessProfileRepository,
      ServiceRecordRepository serviceRecordRepository,
      FemmeTimeProperties timeProperties,
      SifenInvoiceHeaderService sifenInvoiceHeaderService) {
    this.invoiceRepository = invoiceRepository;
    this.cashSessionRepository = cashSessionRepository;
    this.fiscalStampRepository = fiscalStampRepository;
    this.clientRepository = clientRepository;
    this.tenantRepository = tenantRepository;
    this.salonServiceRepository = salonServiceRepository;
    this.businessProfileRepository = businessProfileRepository;
    this.serviceRecordRepository = serviceRecordRepository;
    this.timeProperties = timeProperties;
    this.sifenInvoiceHeaderService = sifenInvoiceHeaderService;
  }

  @Transactional
  public InvoiceResponse issueInvoice(long tenantId, InvoiceCreateRequest request) {
    // 1. Require open cash session
    CashSession cashSession =
        cashSessionRepository
            .findFirstByTenant_IdAndClosedAtIsNullOrderByOpenedAtDesc(tenantId)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.CONFLICT, "CASH_SESSION_NOT_OPEN"));

    // 2. Require active valid fiscal stamp
    FiscalStamp stamp =
        fiscalStampRepository
            .lockByIdAndTenantId(
                fiscalStampRepository
                    .findByTenant_IdAndActiveTrue(tenantId)
                    .orElseThrow(
                        () ->
                            new ResponseStatusException(
                                HttpStatus.CONFLICT, "NO_ACTIVE_FISCAL_STAMP"))
                    .getId(),
                tenantId)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.CONFLICT, "NO_ACTIVE_FISCAL_STAMP"));

    LocalDate today = LocalDate.now(ZoneId.systemDefault());
    if (today.isBefore(stamp.getValidFrom()) || today.isAfter(stamp.getValidUntil())) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "FISCAL_STAMP_NOT_VALID");
    }

    // 3. Compute next invoice number
    int nextNumber = stamp.getNextEmissionNumber();
    if (nextNumber > stamp.getRangeTo()) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "FISCAL_STAMP_RANGE_EXHAUSTED");
    }

    Tenant tenant =
        tenantRepository
            .findById(tenantId)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "TENANT_NOT_FOUND"));

    Invoice invoice = new Invoice();
    invoice.setTenant(tenant);
    invoice.setCashSession(cashSession);
    invoice.setFiscalStamp(stamp);
    invoice.setInvoiceNumber(nextNumber);
    invoice.setIssuedAt(Instant.now());
    invoice.setStatus(InvoiceStatus.ISSUED);

    // 4. Client
    if (request.clientId() != null) {
      Client client =
          clientRepository
              .findByIdAndTenant_Id(request.clientId(), tenantId)
              .orElseThrow(
                  () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "CLIENT_NOT_FOUND"));
      invoice.setClient(client);
      // clientDisplayName is full name; clientRucOverride can override profile RUC.
      // Issue #96: a blank display name stays blank (PDF prints "Sin nombre") rather than
      // silently falling back to the client's profile name.
      invoice.setClientDisplayName(
          request.clientDisplayName() != null && !request.clientDisplayName().isBlank()
              ? request.clientDisplayName().trim()
              : null);
    } else {
      invoice.setClientDisplayName(
          request.clientDisplayName() != null && !request.clientDisplayName().isBlank()
              ? request.clientDisplayName().trim()
              : OCCASIONAL_CLIENT_DISPLAY_NAME);
    }

    if (request.clientRucOverride() != null && !request.clientRucOverride().isBlank()) {
      invoice.setClientRucOverride(request.clientRucOverride().trim());
    }
    if (request.clientIdentityDocumentOverride() != null
        && !request.clientIdentityDocumentOverride().isBlank()) {
      invoice.setClientIdentityDocumentOverride(request.clientIdentityDocumentOverride().trim());
    }
    if (request.clientIdentityDocumentTypeOverride() != null
        && !request.clientIdentityDocumentTypeOverride().isBlank()) {
      try {
        invoice.setClientIdentityDocumentTypeOverride(
            ClientIdentityDocumentType.valueOf(request.clientIdentityDocumentTypeOverride()));
      } catch (IllegalArgumentException e) {
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_IDENTITY_DOCUMENT_TYPE");
      }
    }

    // Snapshot the salon RUC at issue time so PDF reprints remain faithful
    businessProfileRepository
        .findByTenantId(tenantId)
        .ifPresent(bp -> invoice.setBusinessRuc(bp.getRuc()));

    // 4b. Optional link to the "ficha de servicio" this invoice was generated from —
    // issuing the invoice auto-closes the ficha (Issue #53).
    ServiceRecord serviceRecord = null;
    if (request.serviceRecordId() != null) {
      serviceRecord =
          serviceRecordRepository
              .findByIdAndTenant_Id(request.serviceRecordId(), tenantId)
              .orElseThrow(
                  () ->
                      new ResponseStatusException(
                          HttpStatus.NOT_FOUND, "SERVICE_RECORD_NOT_FOUND"));
      if (serviceRecord.getStatus() != ServiceRecordStatus.OPEN) {
        throw new ResponseStatusException(HttpStatus.CONFLICT, "SERVICE_RECORD_NOT_OPEN");
      }
      if (invoiceRepository.existsByServiceRecord_Id(serviceRecord.getId())) {
        throw new ResponseStatusException(HttpStatus.CONFLICT, "SERVICE_RECORD_ALREADY_INVOICED");
      }
      invoice.setServiceRecord(serviceRecord);
    }

    BigDecimal tipsAmount =
        request.tipsAmount() != null
            ? request.tipsAmount().setScale(2, RoundingMode.HALF_UP)
            : BigDecimal.ZERO;
    invoice.setTipsAmount(tipsAmount);

    // 5. Lines
    if (request.lines() == null || request.lines().isEmpty()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVOICE_LINES_REQUIRED");
    }
    BigDecimal subtotal = BigDecimal.ZERO;
    for (InvoiceLineRequest lr : request.lines()) {
      InvoiceLine line = new InvoiceLine();
      line.setInvoice(invoice);
      line.setDescription(lr.description());
      line.setQuantity(lr.quantity());
      line.setUnitPrice(lr.unitPrice().setScale(2, RoundingMode.HALF_UP));

      BigDecimal grossLineTotal =
          lr.unitPrice()
              .multiply(BigDecimal.valueOf(lr.quantity()))
              .setScale(2, RoundingMode.HALF_UP);

      // Per-line discount (applied before tax snapshot)
      BigDecimal lineDiscountAmount = BigDecimal.ZERO;
      DiscountType lineDiscountType = DiscountType.NONE;
      if (lr.discountType() != null && !lr.discountType().isBlank()) {
        try {
          lineDiscountType = DiscountType.valueOf(lr.discountType().toUpperCase());
        } catch (IllegalArgumentException e) {
          throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_DISCOUNT_TYPE");
        }
      }
      if (lineDiscountType == DiscountType.FIXED && lr.discountValue() != null) {
        lineDiscountAmount = lr.discountValue().setScale(2, RoundingMode.HALF_UP);
        if (lineDiscountAmount.compareTo(grossLineTotal) > 0) {
          lineDiscountAmount = grossLineTotal;
        }
      } else if (lineDiscountType == DiscountType.PERCENT && lr.discountValue() != null) {
        lineDiscountAmount =
            grossLineTotal
                .multiply(lr.discountValue())
                .divide(BigDecimal.valueOf(100), 2, RoundingMode.HALF_UP);
      }
      if (lineDiscountType != DiscountType.NONE) {
        line.setDiscountType(lineDiscountType);
        line.setDiscountValue(lr.discountValue());
      }

      // Net after per-line discount — this is what goes into lineTotal
      BigDecimal lineNet =
          grossLineTotal.subtract(lineDiscountAmount).setScale(2, RoundingMode.HALF_UP);
      if (lineNet.compareTo(BigDecimal.ZERO) < 0) {
        lineNet = BigDecimal.ZERO;
      }
      line.setLineTotal(lineNet);

      // Tax: snapshot rate from the linked service and compute IVA-incluido amount
      BigDecimal taxRate = BigDecimal.ZERO;
      if (lr.serviceId() != null) {
        var salonService =
            salonServiceRepository
                .findByIdAndTenant_Id(lr.serviceId(), tenantId)
                .orElseThrow(
                    () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "SERVICE_NOT_FOUND"));
        line.setSalonService(salonService);
        if (salonService.getTax() != null) {
          taxRate = salonService.getTax().getRate();
        }
      }
      line.setTaxRate(taxRate.setScale(4, RoundingMode.HALF_UP));
      BigDecimal taxAmount = BigDecimal.ZERO;
      if (taxRate.compareTo(BigDecimal.ZERO) > 0) {
        // IVA-incluido: taxAmount = lineNet * rate / (100 + rate)
        taxAmount =
            lineNet
                .multiply(taxRate)
                .divide(BigDecimal.valueOf(100).add(taxRate), 4, RoundingMode.HALF_UP);
      }
      line.setTaxAmount(taxAmount);

      subtotal = subtotal.add(lineNet);
      invoice.getLines().add(line);
    }
    invoice.setSubtotal(subtotal.setScale(2, RoundingMode.HALF_UP));

    // 6. Discount
    BigDecimal discountAmount = BigDecimal.ZERO;
    DiscountType discountType = DiscountType.NONE;
    if (request.discountType() != null) {
      try {
        discountType = DiscountType.valueOf(request.discountType().toUpperCase());
      } catch (IllegalArgumentException e) {
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_DISCOUNT_TYPE");
      }
    }
    if (discountType == DiscountType.FIXED && request.discountValue() != null) {
      discountAmount = request.discountValue().setScale(2, RoundingMode.HALF_UP);
      if (discountAmount.compareTo(subtotal) > 0) {
        discountAmount = subtotal;
      }
    } else if (discountType == DiscountType.PERCENT && request.discountValue() != null) {
      discountAmount =
          subtotal
              .multiply(request.discountValue())
              .divide(BigDecimal.valueOf(100), 2, RoundingMode.HALF_UP);
    }
    invoice.setDiscountType(discountType);
    if (discountType != DiscountType.NONE) {
      invoice.setDiscountValue(request.discountValue());
    }

    BigDecimal total = subtotal.subtract(discountAmount).setScale(2, RoundingMode.HALF_UP);
    if (total.compareTo(BigDecimal.ZERO) < 0) {
      total = BigDecimal.ZERO;
    }
    invoice.setTotal(total);

    // 6b. SIFEN HU-02 AC-05: Gs. 7.000.000+ requires client identification (RUC or identity
    // document), sin excepción — checked here so it blocks issuance up front, before payments.
    if (total.compareTo(CLIENT_IDENTIFICATION_THRESHOLD) >= 0) {
      Client linkedClient = invoice.getClient();
      String ruc =
          (invoice.getClientRucOverride() != null && !invoice.getClientRucOverride().isBlank())
              ? invoice.getClientRucOverride()
              : (linkedClient != null ? linkedClient.getRuc() : null);
      String identityDocument =
          (invoice.getClientIdentityDocumentOverride() != null
                  && !invoice.getClientIdentityDocumentOverride().isBlank())
              ? invoice.getClientIdentityDocumentOverride()
              : (linkedClient != null ? linkedClient.getIdentityDocumentNumber() : null);
      ClientIdentityDocumentType explicitType =
          invoice.getClientIdentityDocumentTypeOverride() != null
              ? invoice.getClientIdentityDocumentTypeOverride()
              : (linkedClient != null ? linkedClient.getIdentityDocumentType() : null);
      ClientIdentityDocumentType resolvedType =
          ClientIdentityDocumentType.resolve(explicitType, ruc, identityDocument);
      if (resolvedType == ClientIdentityDocumentType.INNOMINADO) {
        throw new ResponseStatusException(
            HttpStatus.BAD_REQUEST, "SIFEN_CLIENT_IDENTIFICATION_REQUIRED");
      }
    }

    // 7. Payments
    if (request.payments() == null || request.payments().isEmpty()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "PAYMENTS_REQUIRED");
    }
    BigDecimal paymentsSum = BigDecimal.ZERO;
    for (InvoicePaymentAllocationRequest pr : request.payments()) {
      PaymentMethod method;
      try {
        method = PaymentMethod.valueOf(pr.method().toUpperCase());
      } catch (IllegalArgumentException e) {
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_PAYMENT_METHOD");
      }
      InvoicePaymentAllocation allocation = new InvoicePaymentAllocation();
      allocation.setInvoice(invoice);
      allocation.setMethod(method);
      allocation.setAmount(pr.amount().setScale(2, RoundingMode.HALF_UP));
      invoice.getPaymentAllocations().add(allocation);
      paymentsSum = paymentsSum.add(pr.amount());
    }

    // 8. Validate payment sum equals total + tips (tips are collected but not fiscal)
    BigDecimal requiredPayment = total.add(tipsAmount);
    if (paymentsSum.setScale(2, RoundingMode.HALF_UP).compareTo(requiredPayment) != 0) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "PAYMENT_SUM_MISMATCH");
    }

    // 9. Save and increment stamp
    invoiceRepository.save(invoice);
    stamp.setNextEmissionNumber(nextNumber + 1);
    stamp.setLockedAfterInvoice(true);

    // 10. Auto-close the linked ficha de servicio, if any (Issue #53)
    if (serviceRecord != null) {
      serviceRecord.setStatus(ServiceRecordStatus.CLOSED);
      serviceRecord.setClosedAt(Instant.now());
    }

    return toDetailDto(invoice);
  }

  @Transactional(readOnly = true)
  public PagedInvoicesResponse listInvoices(
      long tenantId,
      Instant fromDate,
      Instant toDate,
      Long clientId,
      String statusStr,
      String q,
      int page,
      int size) {
    Instant[] fromTo = resolveInvoiceListRange(fromDate, toDate, clientId);
    InvoiceStatus status = null;
    if (statusStr != null && !statusStr.isBlank()) {
      try {
        status = InvoiceStatus.valueOf(statusStr.toUpperCase());
      } catch (IllegalArgumentException e) {
        // ignore bad status filter
      }
    }
    String qTrimmed = (q != null && !q.isBlank()) ? q.trim() : null;
    Integer qInvoiceNumber = parseInvoiceNumberQuery(qTrimmed);
    Pageable pageable = PageRequest.of(page, Math.max(1, Math.min(size, 200)));
    Page<Invoice> invoicePage =
        invoiceRepository.findByTenantWithFiltersPaged(
            tenantId, fromTo[0], fromTo[1], clientId, status, qTrimmed, qInvoiceNumber, pageable);
    BigDecimal issuedTotal =
        invoiceRepository.sumIssuedTotalWithFilters(
            tenantId, fromTo[0], fromTo[1], clientId, qTrimmed, qInvoiceNumber);
    List<InvoiceListItemResponse> content =
        invoicePage.getContent().stream()
            .map(InvoiceService::toListItemDto)
            .collect(Collectors.toList());
    return new PagedInvoicesResponse(
        content,
        invoicePage.getNumber(),
        invoicePage.getSize(),
        invoicePage.getTotalElements(),
        invoicePage.getTotalPages(),
        issuedTotal != null ? issuedTotal : BigDecimal.ZERO);
  }

  /**
   * Resolves the effective date range for invoice list queries.
   *
   * <ul>
   *   <li>Both dates null → default to last {@value MAX_INVOICE_LIST_MONTHS} months.
   *   <li>Only one of from/to → 400 INVOICE_LIST_RANGE_INCOMPLETE.
   *   <li>from after to → 400 INVOICE_LIST_INVALID_RANGE.
   *   <li>from older than 6 months ago → 400 INVOICE_LIST_RANGE_TOO_OLD.
   * </ul>
   */
  static Instant[] resolveInvoiceListRange(Instant from, Instant to, Long clientId) {
    ZoneId zone = ZoneId.systemDefault();
    if (from == null && to == null) {
      LocalDate today = LocalDate.now(zone);
      Instant start = today.minusMonths(MAX_INVOICE_LIST_MONTHS).atStartOfDay(zone).toInstant();
      Instant end = today.atTime(LocalTime.of(23, 59, 59, 999_000_000)).atZone(zone).toInstant();
      return new Instant[] {start, end};
    }
    if (from == null || to == null) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVOICE_LIST_RANGE_INCOMPLETE");
    }
    if (from.isAfter(to)) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVOICE_LIST_INVALID_RANGE");
    }
    // Reject from-dates older than 6 months
    Instant sixMonthsAgo =
        LocalDate.now(zone).minusMonths(MAX_INVOICE_LIST_MONTHS).atStartOfDay(zone).toInstant();
    if (from.isBefore(sixMonthsAgo)) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVOICE_LIST_RANGE_TOO_OLD");
    }
    return new Instant[] {from, to};
  }

  @Transactional(readOnly = true)
  public InvoiceResponse getInvoice(long tenantId, long invoiceId) {
    Invoice invoice =
        invoiceRepository
            .findByIdAndTenant_Id(invoiceId, tenantId)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "INVOICE_NOT_FOUND"));
    Hibernate.initialize(invoice.getLines());
    Hibernate.initialize(invoice.getPaymentAllocations());
    return toDetailDto(invoice);
  }

  @Transactional
  public InvoiceResponse voidInvoice(long tenantId, long invoiceId, InvoiceVoidRequest request) {
    Invoice invoice =
        invoiceRepository
            .findByIdAndTenant_Id(invoiceId, tenantId)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "INVOICE_NOT_FOUND"));

    if (invoice.getStatus() == InvoiceStatus.VOIDED) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "INVOICE_ALREADY_VOIDED");
    }

    // Restriction: cannot void if cash session for this invoice is closed
    CashSession session = invoice.getCashSession();
    if (session.getClosedAt() != null) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "CASH_SESSION_CLOSED_CANNOT_VOID");
    }

    invoice.setStatus(InvoiceStatus.VOIDED);
    invoice.setVoidReason(request.voidReason().trim());

    Hibernate.initialize(invoice.getLines());
    Hibernate.initialize(invoice.getPaymentAllocations());
    return toDetailDto(invoice);
  }

  private static InvoiceListItemResponse toListItemDto(Invoice i) {
    Hibernate.initialize(i.getLines());
    Hibernate.initialize(i.getPaymentAllocations());
    return new InvoiceListItemResponse(
        i.getId(),
        i.getInvoiceNumber(),
        formatInvoiceNumber(i.getInvoiceNumber()),
        i.getClientDisplayName(),
        i.getStatus().name(),
        i.getTotal(),
        i.getIssuedAt(),
        buildServicesSummary(i),
        buildPaymentMethodsSummary(i),
        i.getSifenSubmissionStatus() != null ? i.getSifenSubmissionStatus().name() : null);
  }

  private static String buildServicesSummary(Invoice i) {
    if (i.getLines() == null || i.getLines().isEmpty()) {
      return "";
    }
    String s =
        i.getLines().stream()
            .map(InvoiceLine::getDescription)
            .filter(Objects::nonNull)
            .map(String::trim)
            .filter(desc -> !desc.isEmpty())
            .collect(Collectors.joining(", "));
    if (s.length() > 120) {
      return s.substring(0, 117) + "...";
    }
    return s;
  }

  private static String buildPaymentMethodsSummary(Invoice i) {
    if (i.getPaymentAllocations() == null || i.getPaymentAllocations().isEmpty()) {
      return "";
    }
    return i.getPaymentAllocations().stream()
        .map(InvoicePaymentAllocation::getMethod)
        .map(PaymentMethod::name)
        .distinct()
        .collect(Collectors.joining(", "));
  }

  private InvoiceResponse toDetailDto(Invoice i) {
    List<InvoiceLineResponse> lines =
        i.getLines().stream()
            .map(
                l ->
                    new InvoiceLineResponse(
                        l.getId(),
                        l.getSalonService() != null ? l.getSalonService().getId() : null,
                        l.getDescription(),
                        l.getQuantity(),
                        l.getUnitPrice(),
                        l.getDiscountType() != null ? l.getDiscountType().name() : null,
                        l.getDiscountValue(),
                        l.getLineTotal(),
                        l.getTaxRate(),
                        l.getTaxAmount()))
            .collect(Collectors.toList());

    List<InvoicePaymentAllocationResponse> payments =
        i.getPaymentAllocations().stream()
            .map(p -> new InvoicePaymentAllocationResponse(p.getMethod().name(), p.getAmount()))
            .collect(Collectors.toList());

    return new InvoiceResponse(
        i.getId(),
        i.getInvoiceNumber(),
        formatInvoiceNumber(i.getInvoiceNumber()),
        i.getFiscalStamp().getStampNumber(),
        i.getClient() != null ? i.getClient().getId() : null,
        i.getClientDisplayName(),
        i.getClientRucOverride(),
        i.getClientIdentityDocumentOverride(),
        i.getClientIdentityDocumentTypeOverride() != null
            ? i.getClientIdentityDocumentTypeOverride().name()
            : null,
        i.getBusinessRuc(),
        i.getStatus().name(),
        i.getSubtotal(),
        i.getDiscountType() != null ? i.getDiscountType().name() : DiscountType.NONE.name(),
        i.getDiscountValue(),
        i.getTotal(),
        i.getIssuedAt(),
        i.getCashSession().getId(),
        i.getVoidReason(),
        i.getTipsAmount(),
        i.getServiceRecord() != null ? i.getServiceRecord().getId() : null,
        lines,
        payments,
        i.getSifenControlNumber(),
        i.getSifenSubmissionStatus() != null ? i.getSifenSubmissionStatus().name() : null,
        i.getSifenSubmissionProtocolNumber(),
        i.getSifenSubmissionResultCode(),
        i.getSifenSubmissionMessage(),
        i.getSifenQueryDocumentContent(),
        i.getSifenQrUrl(),
        sifenCancellationDeadline(i),
        toInstant(i.getSifenCancellationRequestedAt()),
        i.getSifenCancellationRequestedByEmail(),
        i.getSifenCancellationReason(),
        i.getSifenCancellationResultCode(),
        i.getSifenCancellationMessage(),
        sifenClientIdentificationEligible(i),
        i.isSifenClientIdentified(),
        toInstant(i.getSifenClientIdentificationRequestedAt()),
        i.getSifenClientIdentificationRequestedByEmail(),
        i.getSifenClientIdentificationClientType(),
        i.getSifenClientIdentificationName(),
        i.getSifenClientIdentificationRuc(),
        i.getSifenClientIdentificationIdentityDocument(),
        i.getSifenClientIdentificationAddress(),
        i.getSifenClientIdentificationCountryCode(),
        i.getSifenClientIdentificationResultCode(),
        i.getSifenClientIdentificationMessage());
  }

  /**
   * SIFEN HU-11 AC-01: the "identify client" option only appears for an invoice currently Aprobado/
   * Aprobado con observación, issued without client data (an anonymous/"Innominado" receiver — see
   * {@link SifenInvoiceHeaderService#isReceiverUnidentified}), and not already identified.
   */
  private boolean sifenClientIdentificationEligible(Invoice i) {
    SifenSubmissionStatus status = i.getSifenSubmissionStatus();
    if (status != SifenSubmissionStatus.APPROVED
        && status != SifenSubmissionStatus.APPROVED_WITH_OBSERVATION) {
      return false;
    }
    if (i.isSifenClientIdentified()) {
      return false;
    }
    return sifenInvoiceHeaderService.isReceiverUnidentified(i);
  }

  /**
   * SIFEN HU-10 AC-02: only present while the invoice is actually eligible to be cancelled — i.e.
   * currently Aprobado/Aprobado con observación (never once it's Cancelada, or if it was never
   * approved at all) — so the frontend can show a countdown/disabled-state without reimplementing
   * this system's own eligibility rules ({@code SifenInvoiceCancellationService.requireCancellable}
   * is still the authoritative check the cancel endpoint itself re-validates).
   */
  private Instant sifenCancellationDeadline(Invoice i) {
    SifenSubmissionStatus status = i.getSifenSubmissionStatus();
    if (status != SifenSubmissionStatus.APPROVED
        && status != SifenSubmissionStatus.APPROVED_WITH_OBSERVATION) {
      return null;
    }
    LocalDateTime approvedAt = i.getSifenSubmittedAt();
    if (approvedAt == null) {
      return null;
    }
    return toInstant(approvedAt.plus(SifenInvoiceCancellationService.CANCELLATION_WINDOW));
  }

  private Instant toInstant(LocalDateTime localDateTime) {
    return localDateTime == null ? null : localDateTime.atZone(timeProperties.zoneId()).toInstant();
  }

  private static String formatInvoiceNumber(int number) {
    return String.format("%07d", number);
  }

  /**
   * Lets an all-digit search (e.g. the exact "0000123" shown in the UI, with leading zeros) match
   * the underlying int invoiceNumber even though the substring LIKE match against
   * CAST(invoiceNumber AS string) only sees the unpadded digits.
   */
  private static Integer parseInvoiceNumberQuery(String qTrimmed) {
    if (qTrimmed == null || !qTrimmed.matches("\\d+")) {
      return null;
    }
    try {
      return Integer.valueOf(qTrimmed);
    } catch (NumberFormatException e) {
      return null;
    }
  }
}
