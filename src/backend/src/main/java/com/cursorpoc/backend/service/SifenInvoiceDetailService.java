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

    List<SifenInvoiceLine> lines = buildLines(invoice);
    SifenInvoiceTotals totals = buildTotals(invoice, lines);
    List<SifenPaymentDetail> payments = buildPayments(invoice);

    return new SifenInvoiceDetail(lines, totals, PAYMENT_CONDITION_CASH, payments);
  }

  /**
   * AC-01/AC-02/AC-03/AC-05: una línea por servicio, con su monto neto de descuentos (propio +
   * prorrateo del descuento global de la factura, si existe) y su clasificación de IVA.
   *
   * <p>El descuento global de {@code Invoice} (distinto del descuento por línea, que ya está
   * incluido en {@code InvoiceLine.lineTotal}) no tiene un desglose por ítem propio — se prorratea
   * proporcionalmente al peso de cada línea sobre el subtotal, y la última línea absorbe el resto
   * del redondeo para garantizar que la suma de las líneas sea exactamente el total de la factura
   * (AC-04).
   */
  private List<SifenInvoiceLine> buildLines(Invoice invoice) {
    List<InvoiceLine> source = invoice.getLines();
    BigDecimal subtotal = invoice.getSubtotal();
    BigDecimal globalDiscount = subtotal.subtract(invoice.getTotal());
    if (globalDiscount.compareTo(BigDecimal.ZERO) < 0) {
      globalDiscount = BigDecimal.ZERO;
    }

    List<SifenInvoiceLine> result = new ArrayList<>(source.size());
    BigDecimal proratedSoFar = BigDecimal.ZERO;
    for (int i = 0; i < source.size(); i++) {
      InvoiceLine line = source.get(i);
      boolean isLast = i == source.size() - 1;

      BigDecimal proratedGlobalDiscount;
      if (globalDiscount.compareTo(BigDecimal.ZERO) == 0
          || subtotal.compareTo(BigDecimal.ZERO) == 0) {
        proratedGlobalDiscount = BigDecimal.ZERO;
      } else if (isLast) {
        proratedGlobalDiscount = globalDiscount.subtract(proratedSoFar);
      } else {
        proratedGlobalDiscount =
            globalDiscount.multiply(line.getLineTotal()).divide(subtotal, 2, RoundingMode.HALF_UP);
        proratedSoFar = proratedSoFar.add(proratedGlobalDiscount);
      }

      BigDecimal grossLineTotal =
          line.getUnitPrice().multiply(BigDecimal.valueOf(line.getQuantity()));
      BigDecimal perLineDiscount = grossLineTotal.subtract(line.getLineTotal());
      BigDecimal netTotal = line.getLineTotal().subtract(proratedGlobalDiscount);
      BigDecimal discountAmount = perLineDiscount.add(proratedGlobalDiscount);

      result.add(buildLine(line, netTotal, discountAmount));
    }
    return result;
  }

  private SifenInvoiceLine buildLine(
      InvoiceLine line, BigDecimal netTotal, BigDecimal discountAmount) {
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
        discountAmount,
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
  private SifenInvoiceTotals buildTotals(Invoice invoice, List<SifenInvoiceLine> lines) {
    BigDecimal exempt = BigDecimal.ZERO;
    BigDecimal taxed5 = BigDecimal.ZERO;
    BigDecimal taxed10 = BigDecimal.ZERO;
    BigDecimal base5 = BigDecimal.ZERO;
    BigDecimal base10 = BigDecimal.ZERO;
    BigDecimal iva5 = BigDecimal.ZERO;
    BigDecimal iva10 = BigDecimal.ZERO;
    BigDecimal perLineDiscount = BigDecimal.ZERO;

    List<InvoiceLine> source = invoice.getLines();
    for (int i = 0; i < lines.size(); i++) {
      SifenInvoiceLine line = lines.get(i);
      InvoiceLine sourceLine = source.get(i);
      BigDecimal grossLineTotal =
          sourceLine.getUnitPrice().multiply(BigDecimal.valueOf(sourceLine.getQuantity()));
      perLineDiscount = perLineDiscount.add(grossLineTotal.subtract(sourceLine.getLineTotal()));

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
    BigDecimal subtotal = invoice.getSubtotal();
    BigDecimal globalDiscount = subtotal.subtract(invoice.getTotal());
    if (globalDiscount.compareTo(BigDecimal.ZERO) < 0) {
      globalDiscount = BigDecimal.ZERO;
    }

    return new SifenInvoiceTotals(
        exempt,
        taxed5,
        taxed10,
        gross,
        perLineDiscount,
        globalDiscount,
        perLineDiscount.add(globalDiscount),
        gross, // F014 = F008 - dRedon(0) + dComi(0): sin redondeo ni comisión en este dominio
        base5,
        base10,
        base5.add(base10),
        iva5,
        iva10,
        iva5.add(iva10));
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
