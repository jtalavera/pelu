package com.cursorpoc.backend.service;

import com.cursorpoc.backend.domain.Invoice;
import com.cursorpoc.backend.domain.InvoiceLine;
import com.cursorpoc.backend.domain.InvoicePaymentAllocation;
import com.cursorpoc.backend.domain.enums.PaymentMethod;
import com.cursorpoc.backend.domain.enums.SifenTaxAffectation;
import com.cursorpoc.backend.repository.InvoiceRepository;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * SIFEN HU-03: completa, para una factura ya emitida, el detalle de servicios facturados y los
 * totales/impuestos que SIFEN exige (Manual Técnico V150, grupos E8 y F).
 *
 * <p>Sin endpoint HTTP ni pantalla propia — igual que HU-01/HU-02/HU-05/HU-21, es una capacidad de
 * servicio consumida por historias futuras (HU-04 la va a combinar con {@link SifenInvoiceHeader}
 * antes de firmar). El sistema ya calculaba subtotal/descuento/IVA por línea para la factura
 * tradicional ({@code InvoiceService.issueInvoice}); este servicio solo remapea ese cálculo
 * existente al shape que exige SIFEN, sin tocar {@code InvoiceService}.
 */
@Service
public class SifenInvoiceDetailService {

  /**
   * SIFEN Tabla 5 (Unidad de Medida): "77" = Unidad. Todo servicio de este dominio se cobra por
   * unidad.
   */
  private static final String UNIT_OF_MEASURE_CODE = "77";

  /** E708/dDesProSer: longitud máxima 120 (AC-01). */
  private static final int MAX_ITEM_NAME_LENGTH = 120;

  /** E714/dInfItem: longitud máxima 500 — donde va el resto de una descripción larga (AC-02). */
  private static final int MAX_ADDITIONAL_INFO_LENGTH = 500;

  /**
   * E601/iCondOpe: 1 = Contado. Este sistema nunca emite con saldo pendiente — los pagos deben
   * sumar exactamente el total al momento de emitir ({@code InvoiceService.issueInvoice}, paso 8) —
   * así que "Crédito" (2) no es alcanzable.
   */
  private static final int PAYMENT_CONDITION_CASH = 1;

  private final InvoiceRepository invoiceRepository;

  public SifenInvoiceDetailService(InvoiceRepository invoiceRepository) {
    this.invoiceRepository = invoiceRepository;
  }

  @Transactional(readOnly = true)
  public SifenInvoiceDetail buildDetail(long tenantId, long invoiceId) {
    Invoice invoice =
        invoiceRepository
            .findByIdAndTenant_Id(invoiceId, tenantId)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "INVOICE_NOT_FOUND"));

    BigDecimal globalDiscountPercent = globalDiscountPercent(invoice);
    List<SifenInvoiceLine> lines = buildLines(invoice, globalDiscountPercent);
    SifenInvoiceTotals totals = buildTotals(invoice, lines, globalDiscountPercent);
    List<SifenPaymentDetail> payments = buildPayments(invoice);

    return new SifenInvoiceDetail(lines, totals, PAYMENT_CONDITION_CASH, payments);
  }

  /**
   * EA004/dDescGloItem (Manual Técnico V150, E8.1.1): "Si se cuenta con un descuento global, debe
   * ser aplicado (no es prorrateado) a cada uno de los ítems, independientemente que un ítem cuente
   * con un descuento particular" — a single percentage, applied uniformly to every line's own unit
   * price, not the invoice-level discount amount split by each line's weight (which is what this
   * used to do, and which SIFEN rejected live — dCodRes=1862 — the moment a line also carried its
   * own particular discount, since that skews a value-weighted split away from a flat rate).
   * Computed once against the gross (pre-any-discount) total of every line, so the same percentage
   * ties out exactly across the whole invoice regardless of per-line item discounts.
   */
  private static BigDecimal globalDiscountPercent(Invoice invoice) {
    BigDecimal subtotal = invoice.getSubtotal();
    BigDecimal globalDiscount = subtotal.subtract(invoice.getTotal());
    if (globalDiscount.compareTo(BigDecimal.ZERO) < 0) {
      globalDiscount = BigDecimal.ZERO;
    }
    BigDecimal grossSubtotal =
        invoice.getLines().stream()
            .map(l -> l.getUnitPrice().multiply(BigDecimal.valueOf(l.getQuantity())))
            .reduce(BigDecimal.ZERO, BigDecimal::add);
    if (globalDiscount.signum() == 0 || grossSubtotal.signum() == 0) {
      return BigDecimal.ZERO;
    }
    return globalDiscount
        .multiply(BigDecimal.valueOf(100))
        .divide(grossSubtotal, 8, RoundingMode.HALF_UP);
  }

  /** AC-01/AC-02/AC-03/AC-05: una línea por servicio, con su desglose de descuentos e IVA. */
  private List<SifenInvoiceLine> buildLines(Invoice invoice, BigDecimal globalDiscountPercent) {
    List<SifenInvoiceLine> result = new ArrayList<>(invoice.getLines().size());
    for (InvoiceLine line : invoice.getLines()) {
      result.add(buildLine(line, globalDiscountPercent));
    }
    return result;
  }

  private SifenInvoiceLine buildLine(InvoiceLine line, BigDecimal globalDiscountPercent) {
    BigDecimal quantity = BigDecimal.valueOf(line.getQuantity());
    BigDecimal grossLineTotal = line.getUnitPrice().multiply(quantity);
    // EA002/dDescItem, per-unit — this line's own particular discount, isolated to itself.
    BigDecimal itemDiscountAmount =
        grossLineTotal.subtract(line.getLineTotal()).divide(quantity, 2, RoundingMode.HALF_UP);
    // EA004/dDescGloItem, per-unit — the flat global-discount percentage applied to this line's
    // own unit price (see globalDiscountPercent's javadoc for why it isn't prorated).
    BigDecimal globalDiscountAmount =
        line.getUnitPrice()
            .multiply(globalDiscountPercent)
            .divide(BigDecimal.valueOf(100), 2, RoundingMode.HALF_UP);
    // EA008/dTotOpeItem: (E721 - EA002 - EA004) * E711 — the manual's own formula (regla EA008,
    // código 1853, checks this arithmetic directly), not a value-weighted proration of
    // Invoice.total.
    BigDecimal netTotal =
        line.getUnitPrice()
            .subtract(itemDiscountAmount)
            .subtract(globalDiscountAmount)
            .multiply(quantity);

    BigDecimal taxRate = line.getTaxRate() != null ? line.getTaxRate() : BigDecimal.ZERO;
    boolean taxed = taxRate.compareTo(BigDecimal.ZERO) > 0;

    SifenTaxAffectation affectation =
        taxed ? SifenTaxAffectation.GRAVADO : SifenTaxAffectation.EXENTO;
    BigDecimal ratePercent;
    BigDecimal taxableBase;
    BigDecimal taxAmount;
    if (taxed) {
      // AC-03: el manual solo acepta 5 o 10 para E734/dTasaIVA cuando E731=1 (Gravado).
      ratePercent = requireSupportedRate(taxRate);
      // E735/dBasGravIVA = EA008 / (1 + tasa/100); E736/dLiqIVAItem = E735 * (tasa/100) — mismas
      // fórmulas del manual, en dos pasos (no un cálculo directo), tal como las define.
      BigDecimal divisor =
          BigDecimal.ONE.add(ratePercent.divide(BigDecimal.valueOf(100), 8, RoundingMode.HALF_UP));
      taxableBase = netTotal.divide(divisor, 4, RoundingMode.HALF_UP);
      taxAmount =
          taxableBase
              .multiply(ratePercent)
              .divide(BigDecimal.valueOf(100), 4, RoundingMode.HALF_UP);
    } else {
      ratePercent = BigDecimal.ZERO;
      taxableBase = BigDecimal.ZERO;
      taxAmount = BigDecimal.ZERO;
    }

    String fullDescription = line.getDescription();
    boolean tooLongForItemName = fullDescription.length() > MAX_ITEM_NAME_LENGTH;
    String itemName =
        tooLongForItemName ? fullDescription.substring(0, MAX_ITEM_NAME_LENGTH) : fullDescription;
    String additionalInfo =
        tooLongForItemName
            ? fullDescription.substring(
                0, Math.min(fullDescription.length(), MAX_ADDITIONAL_INFO_LENGTH))
            : null;

    String internalCode =
        line.getSalonService() != null
            ? "SVC-" + line.getSalonService().getId()
            : "LIN-" + line.getId();

    return new SifenInvoiceLine(
        internalCode,
        itemName,
        additionalInfo,
        line.getQuantity(),
        UNIT_OF_MEASURE_CODE,
        line.getUnitPrice(),
        itemDiscountAmount,
        globalDiscountAmount,
        netTotal,
        affectation,
        BigDecimal.valueOf(100),
        ratePercent,
        taxableBase,
        taxAmount);
  }

  private static BigDecimal requireSupportedRate(BigDecimal rate) {
    if (rate.compareTo(BigDecimal.valueOf(5)) == 0) {
      return BigDecimal.valueOf(5);
    }
    if (rate.compareTo(BigDecimal.valueOf(10)) == 0) {
      return BigDecimal.valueOf(10);
    }
    throw new ResponseStatusException(HttpStatus.PRECONDITION_FAILED, "SIFEN_UNSUPPORTED_TAX_RATE");
  }

  /** AC-03/AC-04: sumas derivadas de las líneas ya construidas — siempre consistentes con ellas. */
  private SifenInvoiceTotals buildTotals(
      Invoice invoice, List<SifenInvoiceLine> lines, BigDecimal globalDiscountPercent) {
    BigDecimal exempt = BigDecimal.ZERO;
    BigDecimal taxed5 = BigDecimal.ZERO;
    BigDecimal taxed10 = BigDecimal.ZERO;
    BigDecimal base5 = BigDecimal.ZERO;
    BigDecimal base10 = BigDecimal.ZERO;
    BigDecimal iva5 = BigDecimal.ZERO;
    BigDecimal iva10 = BigDecimal.ZERO;
    BigDecimal itemDiscountTotal = BigDecimal.ZERO;
    BigDecimal globalDiscountTotal = BigDecimal.ZERO;

    for (SifenInvoiceLine line : lines) {
      BigDecimal quantity = BigDecimal.valueOf(line.quantity());
      itemDiscountTotal = itemDiscountTotal.add(line.itemDiscountAmount().multiply(quantity));
      globalDiscountTotal = globalDiscountTotal.add(line.globalDiscountAmount().multiply(quantity));

      if (line.taxAffectation() == SifenTaxAffectation.EXENTO) {
        exempt = exempt.add(line.netTotal());
      } else if (line.taxRatePercent().compareTo(BigDecimal.valueOf(5)) == 0) {
        taxed5 = taxed5.add(line.netTotal());
        base5 = base5.add(line.taxableBase());
        iva5 = iva5.add(line.taxAmount());
      } else {
        taxed10 = taxed10.add(line.netTotal());
        base10 = base10.add(line.taxableBase());
        iva10 = iva10.add(line.taxAmount());
      }
    }

    BigDecimal gross = exempt.add(taxed5).add(taxed10);
    // F012/dRedon: the manual's own plug for the (typically zero, occasionally a few céntimos)
    // rounding gap between the formula-driven per-item totals (EA008, summed here as `gross`) and
    // what Invoice.total actually charged — expected whenever a discount percentage doesn't divide
    // evenly across every item (the same reason SIFEN gives EA003a/EA004 a ±0.8 tolerance).
    BigDecimal roundingAdjustment = gross.subtract(invoice.getTotal());

    return new SifenInvoiceTotals(
        exempt,
        taxed5,
        taxed10,
        gross,
        itemDiscountTotal,
        globalDiscountTotal,
        itemDiscountTotal.add(globalDiscountTotal),
        invoice.getTotal(), // F014/dTotGralOpe: siempre el total real cobrado (AC-04)
        base5,
        base10,
        base5.add(base10),
        iva5,
        iva10,
        iva5.add(iva10),
        globalDiscountPercent,
        roundingAdjustment);
  }

  /** AC-06: forma de pago de cada asignación — venta siempre al contado en este dominio. */
  private List<SifenPaymentDetail> buildPayments(Invoice invoice) {
    List<SifenPaymentDetail> payments = new ArrayList<>();
    for (InvoicePaymentAllocation allocation : invoice.getPaymentAllocations()) {
      payments.add(
          new SifenPaymentDetail(mapPaymentType(allocation.getMethod()), allocation.getAmount()));
    }
    return payments;
  }

  /** E606/iTiPago (Manual Técnico V150, sección E7.1). */
  private static int mapPaymentType(PaymentMethod method) {
    return switch (method) {
      case CASH -> 1;
      case CREDIT_CARD -> 3;
      case DEBIT_CARD -> 4;
      case TRANSFER -> 5;
      case OTHER -> 99;
    };
  }
}
