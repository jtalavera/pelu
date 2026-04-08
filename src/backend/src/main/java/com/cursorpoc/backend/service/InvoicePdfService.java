package com.cursorpoc.backend.service;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.BusinessProfile;
import com.cursorpoc.backend.domain.Invoice;
import com.cursorpoc.backend.domain.InvoiceLine;
import com.cursorpoc.backend.domain.InvoicePaymentAllocation;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.enums.DiscountType;
import com.cursorpoc.backend.domain.enums.InvoiceStatus;
import com.cursorpoc.backend.repository.BusinessProfileRepository;
import com.cursorpoc.backend.repository.InvoiceRepository;
import com.lowagie.text.Document;
import com.lowagie.text.DocumentException;
import com.lowagie.text.Element;
import com.lowagie.text.Font;
import com.lowagie.text.FontFactory;
import com.lowagie.text.Image;
import com.lowagie.text.PageSize;
import com.lowagie.text.Paragraph;
import com.lowagie.text.Phrase;
import com.lowagie.text.pdf.PdfPCell;
import com.lowagie.text.pdf.PdfPTable;
import com.lowagie.text.pdf.PdfWriter;
import java.io.ByteArrayOutputStream;
import java.math.BigDecimal;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Base64;
import java.util.List;
import java.util.Locale;
import org.hibernate.Hibernate;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class InvoicePdfService {

  private static final Font TITLE_FONT = FontFactory.getFont(FontFactory.HELVETICA_BOLD, 14);
  private static final Font BODY_FONT = FontFactory.getFont(FontFactory.HELVETICA, 10);
  private static final Font SMALL_FONT = FontFactory.getFont(FontFactory.HELVETICA, 9);

  private final BusinessProfileRepository businessProfileRepository;
  private final InvoiceRepository invoiceRepository;
  private final BusinessProfileService businessProfileService;
  private final FemmeTimeProperties timeProperties;

  public InvoicePdfService(
      BusinessProfileRepository businessProfileRepository,
      InvoiceRepository invoiceRepository,
      BusinessProfileService businessProfileService,
      FemmeTimeProperties timeProperties) {
    this.businessProfileRepository = businessProfileRepository;
    this.invoiceRepository = invoiceRepository;
    this.businessProfileService = businessProfileService;
    this.timeProperties = timeProperties;
  }

  @Transactional(readOnly = true)
  public byte[] buildInvoicePdf(long invoiceId, long tenantId) {
    if (!businessProfileService.isRucReadyForInvoicing(tenantId)) {
      throw new ResponseStatusException(
          HttpStatus.CONFLICT, "Business RUC is required to generate invoice PDFs");
    }
    Invoice invoice =
        invoiceRepository
            .findByIdAndTenant_Id(invoiceId, tenantId)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Invoice not found"));
    if (invoice.getStatus() != InvoiceStatus.ISSUED) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "Invoice PDF is only available for issued invoices");
    }
    Tenant tenant = invoice.getTenant();
    if (tenant.getId() != tenantId) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Invoice not found");
    }
    Hibernate.initialize(invoice.getLines());
    Hibernate.initialize(invoice.getPaymentAllocations());
    BusinessProfile bp =
        businessProfileRepository
            .findByTenantId(tenantId)
            .orElseThrow(
                () ->
                    new ResponseStatusException(
                        HttpStatus.NOT_FOUND, "Business profile not found"));
    return renderPdf(bp, invoice);
  }

  byte[] renderPdf(BusinessProfile business, Invoice invoice) {
    ZoneId zone = timeProperties.zoneId();
    DateTimeFormatter issuedFmt =
        DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm").withZone(zone).withLocale(Locale.ENGLISH);

    try {
      Document document = new Document(PageSize.A4);
      ByteArrayOutputStream baos = new ByteArrayOutputStream();
      PdfWriter.getInstance(document, baos);
      document.open();

      PdfPTable headerTable = new PdfPTable(2);
      headerTable.setWidthPercentage(100);
      headerTable.setWidths(new float[] {65f, 35f});

      PdfPCell textCell = new PdfPCell();
      textCell.setBorder(PdfPCell.NO_BORDER);
      textCell.addElement(new Paragraph(business.getBusinessName(), TITLE_FONT));
      if (business.getRuc() != null && !business.getRuc().isBlank()) {
        textCell.addElement(new Paragraph("RUC: " + business.getRuc(), BODY_FONT));
      }
      if (business.getAddress() != null && !business.getAddress().isBlank()) {
        textCell.addElement(new Paragraph(business.getAddress(), BODY_FONT));
      }
      if (business.getPhone() != null && !business.getPhone().isBlank()) {
        textCell.addElement(new Paragraph("Tel: " + business.getPhone(), BODY_FONT));
      }
      if (business.getContactEmail() != null && !business.getContactEmail().isBlank()) {
        textCell.addElement(new Paragraph("Email: " + business.getContactEmail(), BODY_FONT));
      }
      headerTable.addCell(textCell);

      PdfPCell logoCell = new PdfPCell();
      logoCell.setBorder(PdfPCell.NO_BORDER);
      logoCell.setHorizontalAlignment(Element.ALIGN_RIGHT);
      addLogoIfPresent(logoCell, business);
      headerTable.addCell(logoCell);

      document.add(headerTable);
      document.add(new Paragraph(" "));

      document.add(
          new Paragraph(
              "Timbrado: "
                  + invoice.getFiscalStamp().getStampNumber()
                  + "   Factura N° "
                  + invoice.getInvoiceNumber(),
              BODY_FONT));
      document.add(new Paragraph("Fecha: " + issuedFmt.format(invoice.getIssuedAt()), SMALL_FONT));

      String clientLabel = invoice.getClientDisplayName();
      if (clientLabel != null && !clientLabel.isBlank()) {
        document.add(new Paragraph("Cliente: " + clientLabel, BODY_FONT));
      }
      if (invoice.getClientRucOverride() != null && !invoice.getClientRucOverride().isBlank()) {
        document.add(new Paragraph("RUC cliente: " + invoice.getClientRucOverride(), BODY_FONT));
      }

      document.add(new Paragraph(" "));

      PdfPTable table = new PdfPTable(4);
      table.setWidthPercentage(100);
      table.setWidths(new float[] {40f, 10f, 25f, 25f});
      addHeaderCell(table, "Descripcion");
      addHeaderCell(table, "Cant.");
      addHeaderCell(table, "P. unit.");
      addHeaderCell(table, "Total");

      List<InvoiceLine> lines = invoice.getLines();
      for (InvoiceLine line : lines) {
        addBodyCell(table, line.getDescription());
        addBodyCell(table, String.valueOf(line.getQuantity()));
        addBodyCell(table, formatMoney(line.getUnitPrice()));
        addBodyCell(table, formatMoney(line.getLineTotal()));
      }
      document.add(table);

      document.add(new Paragraph(" "));
      document.add(new Paragraph("Subtotal: " + formatMoney(invoice.getSubtotal()), BODY_FONT));
      if (invoice.getDiscountType() != null
          && invoice.getDiscountType() != DiscountType.NONE
          && invoice.getDiscountValue() != null) {
        document.add(
            new Paragraph(
                "Descuento ("
                    + discountLabel(invoice.getDiscountType())
                    + "): "
                    + formatMoney(invoice.getDiscountValue()),
                BODY_FONT));
      }
      document.add(new Paragraph("Total: " + formatMoney(invoice.getTotal()), TITLE_FONT));

      document.add(new Paragraph(" "));
      document.add(new Paragraph("Pagos:", BODY_FONT));
      for (InvoicePaymentAllocation p : invoice.getPaymentAllocations()) {
        document.add(
            new Paragraph(p.getMethod().name() + ": " + formatMoney(p.getAmount()), BODY_FONT));
      }

      document.close();
      return baos.toByteArray();
    } catch (DocumentException e) {
      throw new IllegalStateException("Failed to build invoice PDF", e);
    }
  }

  private static String discountLabel(DiscountType type) {
    return switch (type) {
      case PERCENT -> "%";
      case FIXED -> "monto";
      case NONE -> "";
    };
  }

  private static void addLogoIfPresent(PdfPCell target, BusinessProfile business) {
    String s = business.getLogoDataUrl();
    if (s == null || s.isBlank()) {
      return;
    }
    try {
      int comma = s.indexOf(',');
      if (comma < 0 || !s.startsWith("data:image")) {
        return;
      }
      byte[] raw = Base64.getDecoder().decode(s.substring(comma + 1));
      Image img = Image.getInstance(raw);
      img.scaleToFit(120, 60);
      img.setAlignment(Element.ALIGN_RIGHT);
      target.addElement(img);
    } catch (Exception ignored) {
      // Skip invalid logo data
    }
  }

  private static void addHeaderCell(PdfPTable table, String text) {
    PdfPCell c = new PdfPCell(new Phrase(text, BODY_FONT));
    c.setBackgroundColor(new java.awt.Color(240, 240, 240));
    table.addCell(c);
  }

  private static void addBodyCell(PdfPTable table, String text) {
    table.addCell(new PdfPCell(new Phrase(text != null ? text : "", SMALL_FONT)));
  }

  private static String formatMoney(BigDecimal v) {
    if (v == null) {
      return "0";
    }
    return v.toPlainString();
  }
}
