package com.cursorpoc.backend.service;

import com.cursorpoc.backend.domain.AppUser;
import com.cursorpoc.backend.domain.CashSession;
import com.cursorpoc.backend.domain.Invoice;
import com.cursorpoc.backend.domain.InvoiceLateTip;
import com.cursorpoc.backend.domain.InvoiceTip;
import com.cursorpoc.backend.domain.Professional;
import com.cursorpoc.backend.domain.enums.CardBrand;
import com.cursorpoc.backend.domain.enums.InvoiceStatus;
import com.cursorpoc.backend.domain.enums.PaymentMethod;
import com.cursorpoc.backend.repository.AppUserRepository;
import com.cursorpoc.backend.repository.CashSessionRepository;
import com.cursorpoc.backend.repository.InvoiceLateTipRepository;
import com.cursorpoc.backend.repository.InvoiceRepository;
import com.cursorpoc.backend.repository.ProfessionalRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.web.dto.InvoiceTipItemResponse;
import com.cursorpoc.backend.web.dto.InvoiceTipsResponse;
import com.cursorpoc.backend.web.dto.LateTipRequest;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Tips left for the professionals after the invoice was already issued (HU-73).
 *
 * <p>The invoice is never touched: its totals, payments and SIFEN document stay as issued. Each tip
 * records how it was paid and the cash register that was open when it was collected, so the
 * register's expected cash and per-method breakdown include it. Any user who can issue invoices can
 * add them; only the salon administrator can void one (enforced by the controller), which keeps the
 * row (who, when, why) but stops it counting.
 */
@Service
public class InvoiceLateTipService {

  /** Longest void reason accepted (matches the column length). */
  static final int VOID_REASON_MAX = 200;

  /** Longest "other card brand" description accepted (matches the column length). */
  static final int CARD_BRAND_OTHER_MAX = 100;

  private final InvoiceRepository invoiceRepository;
  private final InvoiceLateTipRepository invoiceLateTipRepository;
  private final ProfessionalRepository professionalRepository;
  private final CashSessionRepository cashSessionRepository;
  private final TenantRepository tenantRepository;
  private final AppUserRepository appUserRepository;
  private final TipsService tipsService;

  public InvoiceLateTipService(
      InvoiceRepository invoiceRepository,
      InvoiceLateTipRepository invoiceLateTipRepository,
      ProfessionalRepository professionalRepository,
      CashSessionRepository cashSessionRepository,
      TenantRepository tenantRepository,
      AppUserRepository appUserRepository,
      TipsService tipsService) {
    this.invoiceRepository = invoiceRepository;
    this.invoiceLateTipRepository = invoiceLateTipRepository;
    this.professionalRepository = professionalRepository;
    this.cashSessionRepository = cashSessionRepository;
    this.tenantRepository = tenantRepository;
    this.appUserRepository = appUserRepository;
    this.tipsService = tipsService;
  }

  @Transactional(readOnly = true)
  public InvoiceTipsResponse list(long tenantId, long invoiceId) {
    return toResponse(tenantId, requireInvoice(tenantId, invoiceId));
  }

  /**
   * Saves all the given tips (each with its own amount, payment method and, for cards, brand) in
   * the cash register that is open right now. All or none: the first invalid tip aborts the
   * request.
   */
  @Transactional
  public InvoiceTipsResponse create(
      long tenantId, long userId, long invoiceId, List<LateTipRequest> requests) {
    Invoice invoice = requireInvoice(tenantId, invoiceId);
    if (invoice.getStatus() != InvoiceStatus.ISSUED) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "LATE_TIP_INVOICE_NOT_ISSUED");
    }
    if (requests == null || requests.isEmpty()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "LATE_TIP_REQUIRED");
    }
    CashSession session =
        cashSessionRepository
            .findFirstByTenant_IdAndClosedAtIsNullOrderByOpenedAtDesc(tenantId)
            .orElseThrow(
                () ->
                    new ResponseStatusException(
                        HttpStatus.CONFLICT, "LATE_TIP_NO_OPEN_CASH_SESSION"));
    var tenant =
        tenantRepository
            .findById(tenantId)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "TENANT_NOT_FOUND"));
    AppUser user = appUserRepository.findById(userId).orElse(null);

    // Validate every tip before saving any, so a bad one never leaves the others half-saved.
    List<InvoiceLateTip> toSave = new ArrayList<>();
    for (LateTipRequest request : requests) {
      Professional professional =
          professionalRepository
              .findByIdAndTenant_Id(request.professionalId(), tenantId)
              .orElseThrow(
                  () ->
                      new ResponseStatusException(HttpStatus.NOT_FOUND, "PROFESSIONAL_NOT_FOUND"));
      if (!professional.isActive()) {
        throw new ResponseStatusException(HttpStatus.CONFLICT, "LATE_TIP_PROFESSIONAL_INACTIVE");
      }
      BigDecimal amount = request.amount();
      if (amount == null || amount.compareTo(BigDecimal.ONE) < 0) {
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "LATE_TIP_AMOUNT_INVALID");
      }
      PaymentMethod method = parseMethod(request.paymentMethod());
      CardBrand brand = null;
      String brandOther = null;
      if (method == PaymentMethod.CREDIT_CARD || method == PaymentMethod.DEBIT_CARD) {
        brand = parseBrand(request.cardBrand());
        if (brand == CardBrand.OTHER) {
          brandOther =
              request.cardBrandOtherDescription() == null
                  ? ""
                  : request.cardBrandOtherDescription().trim();
          if (brandOther.isEmpty()) {
            throw new ResponseStatusException(
                HttpStatus.BAD_REQUEST, "CARD_BRAND_OTHER_DESCRIPTION_REQUIRED");
          }
          if (brandOther.length() > CARD_BRAND_OTHER_MAX) {
            throw new ResponseStatusException(
                HttpStatus.BAD_REQUEST, "CARD_BRAND_OTHER_DESCRIPTION_TOO_LONG");
          }
        }
      }

      InvoiceLateTip tip = new InvoiceLateTip();
      tip.setTenant(tenant);
      tip.setInvoice(invoice);
      tip.setProfessional(professional);
      tip.setCashSession(session);
      tip.setAmount(amount.setScale(2, RoundingMode.HALF_UP));
      tip.setPaymentMethod(method);
      tip.setCardBrand(brand);
      tip.setCardBrandOtherDescription(brandOther);
      tip.setCreatedBy(user);
      tip.setCreatedAt(Instant.now());
      toSave.add(tip);
    }
    invoiceLateTipRepository.saveAll(toSave);
    return toResponse(tenantId, invoice);
  }

  /**
   * Voids a late tip (never deleted): it stops counting in the professional's balance and in the
   * register. Refused when the professional already withdrew that money, and when the register
   * where it was collected is closed (a closed register never changes its figures).
   */
  @Transactional
  public InvoiceTipsResponse voidTip(long tenantId, long userId, long tipId, String reason) {
    InvoiceLateTip tip =
        invoiceLateTipRepository
            .findByIdAndTenant(tipId, tenantId)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "LATE_TIP_NOT_FOUND"));
    if (tip.isVoided()) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "LATE_TIP_ALREADY_VOIDED");
    }
    String cleanReason = reason == null || reason.isBlank() ? null : reason.trim();
    if (cleanReason == null) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "LATE_TIP_VOID_REASON_REQUIRED");
    }
    if (cleanReason.length() > VOID_REASON_MAX) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "LATE_TIP_VOID_REASON_TOO_LONG");
    }
    if (tip.getCashSession().getClosedAt() != null) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "LATE_TIP_CASH_SESSION_CLOSED");
    }
    long professionalId = tip.getProfessional().getId();
    BigDecimal newBalance =
        tipsService.getBalance(tenantId, professionalId).balance().subtract(tip.getAmount());
    if (newBalance.signum() < 0) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "LATE_TIP_VOID_EXCEEDS_BALANCE");
    }
    tip.setVoidedAt(Instant.now());
    tip.setVoidedBy(appUserRepository.findById(userId).orElse(null));
    tip.setVoidReason(cleanReason);
    invoiceLateTipRepository.save(tip);
    return toResponse(tenantId, tip.getInvoice());
  }

  private Invoice requireInvoice(long tenantId, long invoiceId) {
    return invoiceRepository
        .findByIdAndTenant_Id(invoiceId, tenantId)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "INVOICE_NOT_FOUND"));
  }

  private InvoiceTipsResponse toResponse(long tenantId, Invoice invoice) {
    List<InvoiceTipItemResponse> items = new ArrayList<>();
    BigDecimal total = BigDecimal.ZERO;
    for (InvoiceTip t : invoice.getTips()) {
      items.add(
          new InvoiceTipItemResponse(
              "ISSUANCE",
              null,
              t.getProfessional().getId(),
              t.getProfessional().getDisplayName(),
              t.getAmount(),
              null,
              null,
              null,
              null,
              null,
              false,
              null,
              null,
              false));
      total = total.add(t.getAmount());
    }
    for (InvoiceLateTip t : invoiceLateTipRepository.findByInvoice(invoice.getId(), tenantId)) {
      items.add(
          new InvoiceTipItemResponse(
              "LATE",
              t.getId(),
              t.getProfessional().getId(),
              t.getProfessional().getDisplayName(),
              t.getAmount(),
              t.getPaymentMethod().name(),
              t.getCardBrand() != null ? t.getCardBrand().name() : null,
              t.getCardBrandOtherDescription(),
              t.getCreatedAt(),
              userName(t.getCreatedBy()),
              t.isVoided(),
              t.getVoidReason(),
              userName(t.getVoidedBy()),
              t.getCashSession().getClosedAt() == null));
      if (!t.isVoided()) {
        total = total.add(t.getAmount());
      }
    }
    Optional<CashSession> open =
        cashSessionRepository.findFirstByTenant_IdAndClosedAtIsNullOrderByOpenedAtDesc(tenantId);
    return new InvoiceTipsResponse(
        invoice.getId(),
        invoice.getStatus().name(),
        items,
        total,
        open.map(CashSession::getId).orElse(null),
        open.map(CashSession::getOpenedAt).orElse(null));
  }

  private static PaymentMethod parseMethod(String value) {
    try {
      return PaymentMethod.valueOf(value == null ? "" : value.toUpperCase());
    } catch (IllegalArgumentException e) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_PAYMENT_METHOD");
    }
  }

  private static CardBrand parseBrand(String value) {
    if (value == null || value.isBlank()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "CARD_BRAND_REQUIRED");
    }
    try {
      return CardBrand.valueOf(value.toUpperCase());
    } catch (IllegalArgumentException e) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "CARD_BRAND_REQUIRED");
    }
  }

  private static String userName(AppUser user) {
    if (user == null) {
      return null;
    }
    return user.getFullName() != null && !user.getFullName().isBlank()
        ? user.getFullName()
        : user.getEmail();
  }
}
