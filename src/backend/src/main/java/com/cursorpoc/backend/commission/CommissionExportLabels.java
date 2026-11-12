package com.cursorpoc.backend.commission;

import java.util.List;
import java.util.Map;

/**
 * Column headers and value labels of the commission exports (CSV and settlement PDF), in the UI
 * language the user picked ({@code es} — default — or {@code en}).
 */
public final class CommissionExportLabels {

  private final boolean english;

  private CommissionExportLabels(boolean english) {
    this.english = english;
  }

  /** Any value other than {@code en…} (null included) falls back to Spanish, the app's default. */
  public static CommissionExportLabels of(String lang) {
    return new CommissionExportLabels(lang != null && lang.toLowerCase().startsWith("en"));
  }

  private String pick(String es, String en) {
    return english ? en : es;
  }

  public List<String> entriesHeader() {
    return english
        ? List.of(
            "Entry ID",
            "Accrual date",
            "Professional",
            "Movement",
            "Reason",
            "Invoice",
            "Item",
            "Item type",
            "Calculation base",
            "Base amount",
            "%",
            "Commission",
            "Settlement ID",
            "Settlement status")
        : List.of(
            "ID movimiento",
            "Fecha de devengo",
            "Profesional",
            "Movimiento",
            "Motivo",
            "Comprobante",
            "Ítem",
            "Tipo de ítem",
            "Base de cálculo",
            "Monto base",
            "%",
            "Comisión",
            "ID liquidación",
            "Estado de liquidación");
  }

  public List<String> settlementsHeader() {
    return english
        ? List.of(
            "Settlement ID",
            "Professional",
            "Period from",
            "Period to",
            "Status",
            "Total",
            "Payment method",
            "Payment reference")
        : List.of(
            "ID liquidación",
            "Profesional",
            "Periodo desde",
            "Periodo hasta",
            "Estado",
            "Total",
            "Medio de pago",
            "Referencia de pago");
  }

  public List<String> pdfTableHeader() {
    return english
        ? List.of("Date", "Invoice", "Item", "Type", "Base", "Base amount", "%", "Commission")
        : List.of("Fecha", "Comprobante", "Ítem", "Tipo", "Base", "Monto base", "%", "Comisión");
  }

  public String status(String code) {
    String key = code == null ? "UNSETTLED" : code;
    Map<String, String> labels =
        english
            ? Map.of(
                "UNSETTLED",
                "Unsettled",
                "DRAFT",
                "Draft",
                "APPROVED",
                "Approved",
                "PAID",
                "Paid",
                "VOIDED",
                "Voided")
            : Map.of(
                "UNSETTLED",
                "Sin liquidar",
                "DRAFT",
                "Borrador",
                "APPROVED",
                "Aprobada",
                "PAID",
                "Pagada",
                "VOIDED",
                "Anulada");
    return labels.getOrDefault(key, key);
  }

  /** Singular item type for a row ("Servicio" / "Producto"). */
  public String kind(String code) {
    if (code == null) {
      return "";
    }
    return switch (code) {
      case "SERVICE" -> pick("Servicio", "Service");
      case "PRODUCT" -> pick("Producto", "Product");
      default -> code;
    };
  }

  /** Plural item type for subtotals ("Servicios" / "Productos"). */
  public String kindPlural(String code) {
    if (code == null) {
      return "";
    }
    return switch (code) {
      case "SERVICE" -> pick("Servicios", "Services");
      case "PRODUCT" -> pick("Productos", "Products");
      default -> code;
    };
  }

  public String base(String code) {
    if (code == null) {
      return "";
    }
    return switch (code) {
      case "NET_OF_TAX" -> pick("Sin IVA", "Excluding VAT");
      case "TAX_INCLUDED" -> pick("Con IVA", "Including VAT");
      default -> code;
    };
  }

  public String sourceType(String code) {
    if (code == null) {
      return "";
    }
    return switch (code) {
      case "INVOICE_LINE" -> pick("Comisión", "Commission");
      case "REVERSAL" -> pick("Reversión", "Reversal");
      case "ADJUSTMENT" -> pick("Ajuste", "Adjustment");
      default -> code;
    };
  }

  public String reason(String code) {
    if (code == null) {
      return "";
    }
    return switch (code) {
      case "REASSIGNMENT" -> pick("Cambio de profesional", "Professional change");
      case "VOID" -> pick("Anulación del comprobante", "Invoice voided");
      case "CORRECTION" -> pick("Corrección del comprobante", "Invoice corrected");
      case "RECALCULATION" -> pick("Recálculo", "Recalculation");
      case "MANUAL_ADJUSTMENT" -> pick("Ajuste manual", "Manual adjustment");
      case "CARRY_FORWARD_OUT" ->
          pick("Saldo negativo trasladado", "Negative balance carried forward");
      case "CARRY_FORWARD_IN" ->
          pick(
              "Saldo negativo de la liquidación anterior", "Negative balance from last settlement");
      case "CARRY_REVERSAL" ->
          pick("Reversión de ajuste por anulación", "Adjustment reversed (settlement voided)");
      default -> code;
    };
  }

  public String title(long id) {
    return pick("Liquidación de comisiones #", "Commission settlement #") + id;
  }

  public String professional() {
    return pick("Profesional", "Professional");
  }

  public String period() {
    return pick("Periodo", "Period");
  }

  public String statusLabel() {
    return pick("Estado", "Status");
  }

  public String calculationBase() {
    return pick("Base de cálculo", "Calculation base");
  }

  public String reversalSuffix() {
    return pick(" (reversión)", " (reversal)");
  }

  public String subtotal() {
    return "Subtotal";
  }

  public String adjustment() {
    return pick("Ajuste", "Adjustment");
  }

  public String total() {
    return "Total";
  }

  public String paidOn() {
    return pick("Pagada el ", "Paid on ");
  }
}
