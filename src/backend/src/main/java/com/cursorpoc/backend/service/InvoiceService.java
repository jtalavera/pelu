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
import com.cursorpoc.backend.domain.enums.CardBrand;
import com.cursorpoc.backend.domain.enums.ClientIdentityDocumentType;
import com.cursorpoc.backend.domain.enums.ClientTaxpayerType;
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
import com.cursorpoc.backend.web.dto.InvoiceCorrectionRequest;
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
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.format.DateTimeParseException;
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

  /**
   * Issue #174 AC-04: SIFEN technical limits for the emission date of a DE — it may be backdated up
   * to 720 hours (30 days) and future-dated up to 120 hours (5 days) relative to the transmission
   * instant. Enforced here so a manually edited emission date can never produce a DE SIFEN would
   * reject outright.
   */
  static final Duration MAX_ISSUE_BACKDATE = Duration.ofHours(720);

  static final Duration MAX_ISSUE_FUTUREDATE = Duration.ofHours(120);

  /**
   * Issue #190: SIFEN's transmission window — the XML must reach SIFEN within 72h of the digital
   * signature ("Manual Técnico: hasta 72 horas posteriores a la información declarada en el campo
   * firma digital"). A correct-and-resend past this window transmits extemporaneously and is very
   * likely to be rejected. Anchored on the emission instant so it survives {@code
   * resetForCorrection} clearing {@code sifenSignedAt}; surfaced (non-blocking) via {@link
   * InvoiceResponse#sifenCorrectResendDeadlineAt}.
   */
  static final Duration SIFEN_CORRECT_RESEND_WINDOW = Duration.ofHours(72);

  /**
   * Issue #174 AC-01: services are priced IVA-incluido (10%). When the receiver presents a "Tarjeta
   * Diplomática de exoneración fiscal", every item and the totals must be shown/emitted net of that
   * IVA — the unit price is divided by this factor and the line becomes exonerada.
   */
  private static final BigDecimal TAX_EXEMPT_DIVISOR = new BigDecimal("1.10");

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
  private final SifenNumberVoidingService sifenNumberVoidingService;
  private final SifenInvoiceSubmissionPersistenceService sifenSubmissionPersistence;

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
      SifenInvoiceHeaderService sifenInvoiceHeaderService,
      SifenNumberVoidingService sifenNumberVoidingService,
      SifenInvoiceSubmissionPersistenceService sifenSubmissionPersistence) {
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
    this.sifenNumberVoidingService = sifenNumberVoidingService;
    this.sifenSubmissionPersistence = sifenSubmissionPersistence;
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
    // Issue #174 AC-04: the emission date is "now" unless the form explicitly sent an edited one,
    // which must then fall inside SIFEN's -720h/+120h window.
    invoice.setIssuedAt(resolveIssuedAt(request.issuedAt()));
    invoice.setStatus(InvoiceStatus.ISSUED);

    // 4. Client identity + recipient email (shared with issue #175's correction flow).
    Client client = applyClientIdentity(tenantId, invoice, ClientIdentityInput.from(request));
    boolean taxExemptReceiver = isTaxExemptReceiver(invoice);

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

    // 5. Lines · 6. Discount · 6b. Gs. 7M identification guard · 7/8. Payments — all shared with
    // issue #175's correction flow.
    BigDecimal subtotal = rebuildLines(tenantId, invoice, request.lines(), taxExemptReceiver);
    BigDecimal total =
        applyGlobalDiscount(invoice, request.discountType(), request.discountValue(), subtotal);
    requireClientIdentificationForThreshold(invoice, total);
    rebuildPayments(invoice, request.payments(), total);

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

  /**
   * Issue #175: corrects the client / lines / discount / payments of a {@code REJECTED} SIFEN
   * invoice and re-queues it for transmission <b>under the exact same CDC</b>. Manual Técnico V150
   * §6.5: the CDC is built only from fields no user can edit in this domain (issuer RUC+DV,
   * document type, establishment, expedition point, document number, contributor type, emission
   * date, emission type, security code), so every field this method can change automatically
   * qualifies for resend under the same number — no runtime "diff" is needed.
   *
   * <p>Never touches {@code sifenControlNumber}, {@code sifenSecurityCode}, {@code invoiceNumber},
   * {@code fiscalStamp} or {@code issuedAt}. The controller then runs the same {@code
   * prepareAndSign} + {@code enqueue} pipeline {@code issueInvoice} uses.
   *
   * <p>Guards (409): {@code INVOICE_ALREADY_VOIDED} if the comprobante is anulado (its number was
   * inutilizado), {@code INVOICE_NOT_REJECTED} if it isn't currently Rechazado, {@code
   * SIFEN_NUMBER_ALREADY_VOIDED} if SIFEN already approved the number's inutilización.
   */
  @Transactional
  public InvoiceResponse correctAndResendInvoice(
      long tenantId, long invoiceId, InvoiceCorrectionRequest request) {
    Invoice invoice =
        invoiceRepository
            .findByIdAndTenant_Id(invoiceId, tenantId)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "INVOICE_NOT_FOUND"));

    if (invoice.getStatus() == InvoiceStatus.VOIDED) {
      // The comprobante was already anulado (e.g. its number was inutilizado ante SIFEN) — its
      // number must never be reused, so a same-CDC resend is off the table.
      throw new ResponseStatusException(HttpStatus.CONFLICT, "INVOICE_ALREADY_VOIDED");
    }
    if (invoice.getSifenSubmissionStatus() != SifenSubmissionStatus.REJECTED) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "INVOICE_NOT_REJECTED");
    }
    // Guard: once SIFEN has actually approved the number's inutilización, it's dead for good.
    sifenNumberVoidingService.requireVoidingStillPending(invoiceId);

    // Wipe the rejected content and re-derive it, on the same Invoice row.
    invoice.getLines().clear();
    invoice.getPaymentAllocations().clear();
    invoice.setClient(null);
    invoice.setClientDisplayName(null);
    invoice.setClientRucOverride(null);
    invoice.setClientIdentityDocumentOverride(null);
    invoice.setClientIdentityDocumentTypeOverride(null);
    invoice.setClientTaxpayerTypeOverride(null);
    invoice.setDiscountType(DiscountType.NONE);
    invoice.setDiscountValue(null);

    applyClientIdentity(tenantId, invoice, ClientIdentityInput.from(request));
    boolean taxExemptReceiver = isTaxExemptReceiver(invoice);
    BigDecimal subtotal = rebuildLines(tenantId, invoice, request.lines(), taxExemptReceiver);
    BigDecimal total =
        applyGlobalDiscount(invoice, request.discountType(), request.discountValue(), subtotal);
    requireClientIdentificationForThreshold(invoice, total);
    rebuildPayments(invoice, request.payments(), total);

    // The number is reused, not abandoned — call off its pending inutilización and clear the
    // rejected SIFEN result so the resend runs through the normal pipeline.
    sifenNumberVoidingService.cancelPendingForInvoice(invoiceId);
    sifenSubmissionPersistence.resetForCorrection(tenantId, invoiceId);

    Hibernate.initialize(invoice.getLines());
    Hibernate.initialize(invoice.getPaymentAllocations());
    return toDetailDto(invoice);
  }

  // ── Shared building blocks (issueInvoice + correctAndResendInvoice) ──────────────────────────

  /**
   * The subset of an invoice request that identifies the client — same fields on {@link
   * InvoiceCreateRequest} and {@link InvoiceCorrectionRequest}.
   */
  private record ClientIdentityInput(
      Long clientId,
      String clientDisplayName,
      String clientRucOverride,
      String clientIdentityDocumentOverride,
      String clientIdentityDocumentTypeOverride,
      String clientTaxpayerTypeOverride,
      String email) {

    static ClientIdentityInput from(InvoiceCreateRequest r) {
      return new ClientIdentityInput(
          r.clientId(),
          r.clientDisplayName(),
          r.clientRucOverride(),
          r.clientIdentityDocumentOverride(),
          r.clientIdentityDocumentTypeOverride(),
          r.clientTaxpayerTypeOverride(),
          r.email());
    }

    static ClientIdentityInput from(InvoiceCorrectionRequest r) {
      return new ClientIdentityInput(
          r.clientId(),
          r.clientDisplayName(),
          r.clientRucOverride(),
          r.clientIdentityDocumentOverride(),
          r.clientIdentityDocumentTypeOverride(),
          r.clientTaxpayerTypeOverride(),
          r.email());
    }
  }

  /**
   * Steps 4 + recipient-email of {@code issueInvoice}. Returns the linked {@link Client} or null.
   */
  private Client applyClientIdentity(long tenantId, Invoice invoice, ClientIdentityInput request) {
    Client client = null;
    if (request.clientId() != null) {
      client =
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
    if (request.clientTaxpayerTypeOverride() != null
        && !request.clientTaxpayerTypeOverride().isBlank()) {
      try {
        invoice.setClientTaxpayerTypeOverride(
            ClientTaxpayerType.valueOf(request.clientTaxpayerTypeOverride()));
      } catch (IllegalArgumentException e) {
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_TAXPAYER_TYPE");
      }
    }

    // Issue #173: recipient email for the KuDE / cancellation notice. Stored on the invoice
    // (takes priority over the client's own email on file) and, when it's a new value for a
    // linked client, written back to that client's profile.
    String recipientEmail =
        request.email() != null && !request.email().isBlank() ? request.email().trim() : null;
    invoice.setRecipientEmail(recipientEmail);
    if (client != null
        && recipientEmail != null
        && !recipientEmail.equalsIgnoreCase(client.getEmail())) {
      if (clientRepository.findByTenantIdAndEmail(tenantId, recipientEmail).isPresent()) {
        throw new ResponseStatusException(HttpStatus.CONFLICT, "CLIENT_EMAIL_DUPLICATE");
      }
      client.setEmail(recipientEmail);
    }
    return client;
  }

  /**
   * Issue #174 AC-01: a "Tarjeta Diplomática de exoneración fiscal" receiver makes the whole sale
   * IVA-exonerada — resolved from the same overrides SIFEN's receiver block reads, so it never
   * falls back to a linked client's profile document (issue #96).
   */
  private static boolean isTaxExemptReceiver(Invoice invoice) {
    return ClientIdentityDocumentType.resolve(
            invoice.getClientIdentityDocumentTypeOverride(),
            invoice.getClientRucOverride(),
            invoice.getClientIdentityDocumentOverride())
        == ClientIdentityDocumentType.TARJETA_DIPLOMATICA;
  }

  /** Step 5 of {@code issueInvoice}: rebuilds {@code invoice.lines}, returns the gross subtotal. */
  private BigDecimal rebuildLines(
      long tenantId,
      Invoice invoice,
      List<InvoiceLineRequest> lineRequests,
      boolean taxExemptReceiver) {
    if (lineRequests == null || lineRequests.isEmpty()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVOICE_LINES_REQUIRED");
    }
    BigDecimal subtotal = BigDecimal.ZERO;
    for (InvoiceLineRequest lr : lineRequests) {
      InvoiceLine line = new InvoiceLine();
      line.setInvoice(invoice);
      line.setDescription(lr.description());
      line.setQuantity(lr.quantity());

      // Issue #174 AC-01: strip the included 10% IVA for a diplomatic-exoneration receiver, so
      // subtotal/total/payments all reconcile on the net amount the client actually pays.
      BigDecimal effectiveUnitPrice =
          taxExemptReceiver
              ? lr.unitPrice().divide(TAX_EXEMPT_DIVISOR, 0, RoundingMode.HALF_UP)
              : lr.unitPrice();
      effectiveUnitPrice = effectiveUnitPrice.setScale(2, RoundingMode.HALF_UP);
      line.setUnitPrice(effectiveUnitPrice);

      BigDecimal grossLineTotal =
          effectiveUnitPrice
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
      // Issue #174 AC-01: an exonerated line carries no IVA at all.
      if (taxExemptReceiver) {
        taxRate = BigDecimal.ZERO;
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
    return subtotal;
  }

  /** Step 6 of {@code issueInvoice}: applies the global discount, returns the total. */
  private BigDecimal applyGlobalDiscount(
      Invoice invoice, String discountTypeStr, BigDecimal discountValue, BigDecimal subtotal) {
    BigDecimal discountAmount = BigDecimal.ZERO;
    DiscountType discountType = DiscountType.NONE;
    if (discountTypeStr != null) {
      try {
        discountType = DiscountType.valueOf(discountTypeStr.toUpperCase());
      } catch (IllegalArgumentException e) {
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_DISCOUNT_TYPE");
      }
    }
    if (discountType == DiscountType.FIXED && discountValue != null) {
      discountAmount = discountValue.setScale(2, RoundingMode.HALF_UP);
      if (discountAmount.compareTo(subtotal) > 0) {
        discountAmount = subtotal;
      }
    } else if (discountType == DiscountType.PERCENT && discountValue != null) {
      discountAmount =
          subtotal.multiply(discountValue).divide(BigDecimal.valueOf(100), 2, RoundingMode.HALF_UP);
    }
    invoice.setDiscountType(discountType);
    if (discountType != DiscountType.NONE) {
      invoice.setDiscountValue(discountValue);
    }

    BigDecimal total = subtotal.subtract(discountAmount).setScale(2, RoundingMode.HALF_UP);
    if (total.compareTo(BigDecimal.ZERO) < 0) {
      total = BigDecimal.ZERO;
    }
    invoice.setTotal(total);
    return total;
  }

  /**
   * Step 6b of {@code issueInvoice}. SIFEN HU-02 AC-05: Gs. 7.000.000+ requires client
   * identification (RUC or identity document), sin excepción. The linked client's profile
   * RUC/document is never used as a fallback — must match {@code
   * SifenInvoiceHeaderService#buildReceiverData} exactly.
   */
  private static void requireClientIdentificationForThreshold(Invoice invoice, BigDecimal total) {
    if (total.compareTo(CLIENT_IDENTIFICATION_THRESHOLD) < 0) {
      return;
    }
    ClientIdentityDocumentType resolvedType =
        ClientIdentityDocumentType.resolve(
            invoice.getClientIdentityDocumentTypeOverride(),
            invoice.getClientRucOverride(),
            invoice.getClientIdentityDocumentOverride());
    if (resolvedType == ClientIdentityDocumentType.INNOMINADO) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "SIFEN_CLIENT_IDENTIFICATION_REQUIRED");
    }
  }

  /** Steps 7 + 8 of {@code issueInvoice}: rebuilds payment allocations and validates the sum. */
  private static void rebuildPayments(
      Invoice invoice, List<InvoicePaymentAllocationRequest> paymentRequests, BigDecimal total) {
    if (paymentRequests == null || paymentRequests.isEmpty()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "PAYMENTS_REQUIRED");
    }
    BigDecimal paymentsSum = BigDecimal.ZERO;
    for (InvoicePaymentAllocationRequest pr : paymentRequests) {
      PaymentMethod method;
      try {
        method = PaymentMethod.valueOf(pr.method().toUpperCase());
      } catch (IllegalArgumentException e) {
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_PAYMENT_METHOD");
      }
      // Issue #170: SIFEN's E7.1.1/gPagTarCD group is mandatory for card payments and requires
      // the card brand.
      CardBrand cardBrand = null;
      if (method == PaymentMethod.CREDIT_CARD || method == PaymentMethod.DEBIT_CARD) {
        if (pr.cardBrand() == null || pr.cardBrand().isBlank()) {
          throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "CARD_BRAND_REQUIRED");
        }
        try {
          cardBrand = CardBrand.valueOf(pr.cardBrand().toUpperCase());
        } catch (IllegalArgumentException e) {
          throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "CARD_BRAND_REQUIRED");
        }
        if (cardBrand == CardBrand.OTHER
            && (pr.cardBrandOtherDescription() == null
                || pr.cardBrandOtherDescription().isBlank())) {
          throw new ResponseStatusException(
              HttpStatus.BAD_REQUEST, "CARD_BRAND_OTHER_DESCRIPTION_REQUIRED");
        }
      }
      InvoicePaymentAllocation allocation = new InvoicePaymentAllocation();
      allocation.setInvoice(invoice);
      allocation.setMethod(method);
      allocation.setAmount(pr.amount().setScale(2, RoundingMode.HALF_UP));
      allocation.setCardBrand(cardBrand);
      allocation.setCardBrandOtherDescription(
          cardBrand == CardBrand.OTHER ? pr.cardBrandOtherDescription() : null);
      invoice.getPaymentAllocations().add(allocation);
      paymentsSum = paymentsSum.add(pr.amount());
    }
    // Issue #139: tips are collected/stored separately and never factor into this reconciliation.
    if (paymentsSum.setScale(2, RoundingMode.HALF_UP).compareTo(total) != 0) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "PAYMENT_SUM_MISMATCH");
    }
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
        invoicePage.getContent().stream().map(this::toListItemDto).collect(Collectors.toList());
    return new PagedInvoicesResponse(
        content,
        invoicePage.getNumber(),
        invoicePage.getSize(),
        invoicePage.getTotalElements(),
        invoicePage.getTotalPages(),
        issuedTotal != null ? issuedTotal : BigDecimal.ZERO);
  }

  /**
   * Issue #174 AC-05: the same filtered invoice list the History tab shows, unpaged (capped), for
   * the Excel/PDF report — header data only, newest first. Reuses the exact filter resolution and
   * query the paged endpoint uses so the report always matches what's on screen.
   */
  @Transactional(readOnly = true)
  public List<InvoiceReportRow> listInvoicesForReport(
      long tenantId, Instant fromDate, Instant toDate, Long clientId, String statusStr, String q) {
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
    return invoiceRepository.findReportRows(
        tenantId,
        fromTo[0],
        fromTo[1],
        clientId,
        status,
        qTrimmed,
        qInvoiceNumber,
        PageRequest.of(0, 5000));
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

  private InvoiceListItemResponse toListItemDto(Invoice i) {
    Hibernate.initialize(i.getLines());
    Hibernate.initialize(i.getPaymentAllocations());
    if (i.getClient() != null) {
      Hibernate.initialize(i.getClient());
    }
    return new InvoiceListItemResponse(
        i.getId(),
        i.getInvoiceNumber(),
        formatInvoiceNumber(i.getInvoiceNumber()),
        i.getClient() != null ? i.getClient().getFullName() : i.getClientDisplayName(),
        i.getStatus().name(),
        i.getTotal(),
        i.getIssuedAt(),
        buildServicesSummary(i),
        buildPaymentMethodsSummary(i),
        i.getSifenSubmissionStatus() != null ? i.getSifenSubmissionStatus().name() : null,
        toInstant(i.getSifenSubmittedAt()));
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
            .map(
                p ->
                    new InvoicePaymentAllocationResponse(
                        p.getMethod().name(),
                        p.getAmount(),
                        p.getCardBrand() != null ? p.getCardBrand().name() : null,
                        p.getCardBrandOtherDescription()))
            .collect(Collectors.toList());

    return new InvoiceResponse(
        i.getId(),
        i.getInvoiceNumber(),
        formatInvoiceNumber(i.getInvoiceNumber()),
        i.getFiscalStamp().getStampNumber(),
        i.getClient() != null ? i.getClient().getId() : null,
        i.getClientDisplayName(),
        i.getClient() != null ? i.getClient().getEmail() : null,
        i.getRecipientEmail(),
        i.getClientRucOverride(),
        i.getClientIdentityDocumentOverride(),
        i.getClientIdentityDocumentTypeOverride() != null
            ? i.getClientIdentityDocumentTypeOverride().name()
            : null,
        i.getClientTaxpayerTypeOverride() != null ? i.getClientTaxpayerTypeOverride().name() : null,
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
        sifenCancellationAvailableAt(i),
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
        i.getSifenClientIdentificationMessage(),
        toInstant(i.getSifenKudeEmailedAt()),
        toInstant(i.getSifenCancellationNotifiedAt()),
        i.getId() == null
            ? null
            : sifenNumberVoidingService.statusForInvoice(i.getId()).map(Enum::name).orElse(null),
        sifenCorrectResendDeadline(i));
  }

  /**
   * Issue #190: the instant past which correcting &amp; resending this rejected DE falls outside
   * SIFEN's 72h transmission window (see {@link #SIFEN_CORRECT_RESEND_WINDOW}). Non-null only while
   * the invoice is actually in the "resolve rejected" flow — Rechazado, not anulado, and its number
   * not already inutilizado ante SIFEN. The frontend uses it only for a non-blocking warning.
   */
  private Instant sifenCorrectResendDeadline(Invoice i) {
    if (i.getSifenSubmissionStatus() != SifenSubmissionStatus.REJECTED
        || i.getStatus() == InvoiceStatus.VOIDED
        || i.getIssuedAt() == null) {
      return null;
    }
    if (i.getId() != null) {
      String voidingStatus =
          sifenNumberVoidingService.statusForInvoice(i.getId()).map(Enum::name).orElse(null);
      if ("APPROVED".equals(voidingStatus) || "APPROVED_WITH_OBSERVATION".equals(voidingStatus)) {
        return null;
      }
    }
    return i.getIssuedAt().plus(SIFEN_CORRECT_RESEND_WINDOW);
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

  /**
   * Issue #145: the instant from which SIFEN cancellation is actually accepted — same eligibility
   * gate as {@link #sifenCancellationDeadline}, offset by {@code MINIMUM_CANCELLATION_DELAY}
   * instead of the 48h window, so the frontend can disable the cancel button and show a cooldown
   * message instead of letting the user hit SIFEN's "extemporáneo" rejection for a just-approved
   * invoice.
   */
  private Instant sifenCancellationAvailableAt(Invoice i) {
    SifenSubmissionStatus status = i.getSifenSubmissionStatus();
    if (status != SifenSubmissionStatus.APPROVED
        && status != SifenSubmissionStatus.APPROVED_WITH_OBSERVATION) {
      return null;
    }
    LocalDateTime approvedAt = i.getSifenSubmittedAt();
    if (approvedAt == null) {
      return null;
    }
    return toInstant(approvedAt.plus(SifenInvoiceCancellationService.MINIMUM_CANCELLATION_DELAY));
  }

  private Instant toInstant(LocalDateTime localDateTime) {
    return localDateTime == null ? null : localDateTime.atZone(timeProperties.zoneId()).toInstant();
  }

  private static String formatInvoiceNumber(int number) {
    return String.format("%07d", number);
  }

  /**
   * Issue #174 AC-04: resolves the invoice's emission date. Absent/blank → "now". Otherwise the ISO
   * instant sent by the form, rejected unless it sits within SIFEN's -720h/+120h window relative to
   * the current instant (the same limit the frontend enforces before submitting).
   */
  static Instant resolveIssuedAt(String issuedAtIso) {
    if (issuedAtIso == null || issuedAtIso.isBlank()) {
      return Instant.now();
    }
    Instant parsed;
    try {
      parsed = Instant.parse(issuedAtIso.trim());
    } catch (DateTimeParseException e) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVOICE_ISSUE_DATE_INVALID");
    }
    Instant now = Instant.now();
    if (parsed.isBefore(now.minus(MAX_ISSUE_BACKDATE))
        || parsed.isAfter(now.plus(MAX_ISSUE_FUTUREDATE))) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVOICE_ISSUE_DATE_OUT_OF_RANGE");
    }
    return parsed;
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
