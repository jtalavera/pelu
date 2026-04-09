package com.cursorpoc.backend.service;

import com.cursorpoc.backend.domain.CashSession;
import com.cursorpoc.backend.domain.Client;
import com.cursorpoc.backend.domain.FiscalStamp;
import com.cursorpoc.backend.domain.Invoice;
import com.cursorpoc.backend.domain.InvoiceLine;
import com.cursorpoc.backend.domain.InvoicePaymentAllocation;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.enums.DiscountType;
import com.cursorpoc.backend.domain.enums.InvoiceStatus;
import com.cursorpoc.backend.domain.enums.PaymentMethod;
import com.cursorpoc.backend.repository.CashSessionRepository;
import com.cursorpoc.backend.repository.ClientRepository;
import com.cursorpoc.backend.repository.FiscalStampRepository;
import com.cursorpoc.backend.repository.InvoiceRepository;
import com.cursorpoc.backend.repository.SalonServiceRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.web.dto.InvoiceCreateRequest;
import com.cursorpoc.backend.web.dto.InvoiceLineRequest;
import com.cursorpoc.backend.web.dto.InvoiceLineResponse;
import com.cursorpoc.backend.web.dto.InvoiceListItemResponse;
import com.cursorpoc.backend.web.dto.InvoicePaymentAllocationRequest;
import com.cursorpoc.backend.web.dto.InvoicePaymentAllocationResponse;
import com.cursorpoc.backend.web.dto.InvoiceResponse;
import com.cursorpoc.backend.web.dto.InvoiceVoidRequest;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.stream.Collectors;
import org.hibernate.Hibernate;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class InvoiceService {

  private static final String OCCASIONAL_CLIENT_DISPLAY_NAME = "CONSUMIDOR FINAL";

  private final InvoiceRepository invoiceRepository;
  private final CashSessionRepository cashSessionRepository;
  private final FiscalStampRepository fiscalStampRepository;
  private final ClientRepository clientRepository;
  private final TenantRepository tenantRepository;
  private final SalonServiceRepository salonServiceRepository;

  public InvoiceService(
      InvoiceRepository invoiceRepository,
      CashSessionRepository cashSessionRepository,
      FiscalStampRepository fiscalStampRepository,
      ClientRepository clientRepository,
      TenantRepository tenantRepository,
      SalonServiceRepository salonServiceRepository) {
    this.invoiceRepository = invoiceRepository;
    this.cashSessionRepository = cashSessionRepository;
    this.fiscalStampRepository = fiscalStampRepository;
    this.clientRepository = clientRepository;
    this.tenantRepository = tenantRepository;
    this.salonServiceRepository = salonServiceRepository;
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
      // clientDisplayName is full name; clientRucOverride can override profile RUC
      invoice.setClientDisplayName(
          request.clientDisplayName() != null && !request.clientDisplayName().isBlank()
              ? request.clientDisplayName().trim()
              : client.getFullName());
    } else {
      invoice.setClientDisplayName(
          request.clientDisplayName() != null && !request.clientDisplayName().isBlank()
              ? request.clientDisplayName().trim()
              : OCCASIONAL_CLIENT_DISPLAY_NAME);
    }

    if (request.clientRucOverride() != null && !request.clientRucOverride().isBlank()) {
      invoice.setClientRucOverride(request.clientRucOverride().trim());
    }

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
      BigDecimal lineTotal =
          lr.unitPrice()
              .multiply(BigDecimal.valueOf(lr.quantity()))
              .setScale(2, RoundingMode.HALF_UP);
      line.setLineTotal(lineTotal);
      subtotal = subtotal.add(lineTotal);
      if (lr.serviceId() != null) {
        var salonService =
            salonServiceRepository
                .findByIdAndTenant_Id(lr.serviceId(), tenantId)
                .orElseThrow(
                    () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "SERVICE_NOT_FOUND"));
        line.setSalonService(salonService);
      }
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

    // 8. Validate payment sum equals total
    if (paymentsSum.setScale(2, RoundingMode.HALF_UP).compareTo(total) != 0) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "PAYMENT_SUM_MISMATCH");
    }

    // 9. Save and increment stamp
    invoiceRepository.save(invoice);
    stamp.setNextEmissionNumber(nextNumber + 1);
    stamp.setLockedAfterInvoice(true);

    return toDetailDto(invoice);
  }

  @Transactional(readOnly = true)
  public List<InvoiceListItemResponse> listInvoices(
      long tenantId, Instant fromDate, Instant toDate, Long clientId, String statusStr) {
    InvoiceStatus status = null;
    if (statusStr != null && !statusStr.isBlank()) {
      try {
        status = InvoiceStatus.valueOf(statusStr.toUpperCase());
      } catch (IllegalArgumentException e) {
        // ignore bad status filter
      }
    }
    return invoiceRepository
        .findByTenantWithFilters(tenantId, fromDate, toDate, clientId, status)
        .stream()
        .map(InvoiceService::toListItemDto)
        .collect(Collectors.toList());
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
    return new InvoiceListItemResponse(
        i.getId(),
        i.getInvoiceNumber(),
        formatInvoiceNumber(i.getInvoiceNumber()),
        i.getClientDisplayName(),
        i.getStatus().name(),
        i.getTotal(),
        i.getIssuedAt());
  }

  private static InvoiceResponse toDetailDto(Invoice i) {
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
                        l.getLineTotal()))
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
        i.getStatus().name(),
        i.getSubtotal(),
        i.getDiscountType() != null ? i.getDiscountType().name() : DiscountType.NONE.name(),
        i.getDiscountValue(),
        i.getTotal(),
        i.getIssuedAt(),
        i.getCashSession().getId(),
        i.getVoidReason(),
        lines,
        payments);
  }

  private static String formatInvoiceNumber(int number) {
    return String.format("%07d", number);
  }
}
