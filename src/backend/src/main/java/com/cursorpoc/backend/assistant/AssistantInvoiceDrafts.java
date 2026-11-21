package com.cursorpoc.backend.assistant;

import com.cursorpoc.backend.assistant.AssistantDraftPayloads.InvoiceDraftPayload;
import com.cursorpoc.backend.assistant.AssistantDraftPayloads.InvoiceDraftPayload.Line;
import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.ServiceRecord;
import com.cursorpoc.backend.domain.ServiceRecordLine;
import com.cursorpoc.backend.domain.enums.ClientIdentityDocumentType;
import com.cursorpoc.backend.domain.enums.PaymentMethod;
import com.cursorpoc.backend.domain.enums.ServiceRecordStatus;
import com.cursorpoc.backend.repository.InvoiceRepository;
import com.cursorpoc.backend.repository.ServiceRecordRepository;
import com.cursorpoc.backend.service.AppointmentService;
import com.cursorpoc.backend.service.ClientService;
import com.cursorpoc.backend.service.InvoiceEmissionService;
import com.cursorpoc.backend.service.ProfessionalDirectoryService;
import com.cursorpoc.backend.service.ServiceCatalogService;
import com.cursorpoc.backend.util.EmailFormatValidator;
import com.cursorpoc.backend.web.dto.AppointmentResponse;
import com.cursorpoc.backend.web.dto.ClientResponse;
import com.cursorpoc.backend.web.dto.InvoiceCreateRequest;
import com.cursorpoc.backend.web.dto.InvoiceLineRequest;
import com.cursorpoc.backend.web.dto.InvoicePaymentAllocationRequest;
import com.cursorpoc.backend.web.dto.ProfessionalOptionResponse;
import com.cursorpoc.backend.web.dto.ServiceResponse;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import org.springframework.stereotype.Component;

/**
 * Everything about INVOICE drafts that is not persistence: what the invoice would charge (catalog
 * services, the client's open service record, or one of her appointments of the day), the price
 * snapshot, what the person still has to complete and the {@link InvoiceCreateRequest} that the
 * regular invoicing road receives on confirmation. Amounts come from the catalog / the record —
 * never from the model.
 */
@Component
public class AssistantInvoiceDrafts {

  /** Payment methods the card offers (the backend knows one more, OTHER, not offered here). */
  public static final Set<String> PAYMENT_METHODS =
      Set.of(
          PaymentMethod.CASH.name(),
          PaymentMethod.DEBIT_CARD.name(),
          PaymentMethod.CREDIT_CARD.name(),
          PaymentMethod.TRANSFER.name());

  /** Card brands the card offers (OTHER would need a free-text description: not offered). */
  /** Largest unit price a person can type on a card (Gs. 999.999.999). */
  private static final BigDecimal MAX_UNIT_PRICE = new BigDecimal("999999999");

  public static final Set<String> CARD_BRANDS =
      Set.of("VISA", "MASTERCARD", "AMEX", "MAESTRO", "PANAL", "CABAL");

  private final ClientService clientService;
  private final ServiceCatalogService catalogService;
  private final ProfessionalDirectoryService professionalService;
  private final AppointmentService appointmentService;
  private final ServiceRecordRepository serviceRecordRepository;
  private final InvoiceRepository invoiceRepository;
  private final InvoiceEmissionService emissionService;
  private final FemmeTimeProperties timeProperties;

  public AssistantInvoiceDrafts(
      ClientService clientService,
      ServiceCatalogService catalogService,
      ProfessionalDirectoryService professionalService,
      AppointmentService appointmentService,
      ServiceRecordRepository serviceRecordRepository,
      InvoiceRepository invoiceRepository,
      InvoiceEmissionService emissionService,
      FemmeTimeProperties timeProperties) {
    this.clientService = clientService;
    this.catalogService = catalogService;
    this.professionalService = professionalService;
    this.appointmentService = appointmentService;
    this.serviceRecordRepository = serviceRecordRepository;
    this.invoiceRepository = invoiceRepository;
    this.emissionService = emissionService;
    this.timeProperties = timeProperties;
  }

  /** What the model asked to invoice. All optional but {@code clientId}. */
  public record Request(
      Long clientId,
      List<Long> serviceIds,
      Long professionalId,
      Long appointmentId,
      String paymentMethod,
      String email) {}

  // ---------------------------------------------------------------------------------------------
  // Building a draft

  /**
   * Builds the payload. What is charged, in this order: the catalog services named; one given
   * appointment; the client's open service record; her single appointment of today. Several
   * candidate appointments, or nothing to charge, are reported so the assistant can ask.
   */
  public InvoiceDraftPayload build(long tenantId, Request req) {
    if (req.clientId() == null) {
      throw new AssistantTools.ToolException("CLIENT_REQUIRED");
    }
    ClientResponse client = clientService.getById(tenantId, req.clientId());
    if (ClientIdentityDocumentType.TARJETA_DIPLOMATICA
        .name()
        .equals(client.identityDocumentType())) {
      // A diplomatic exoneration changes the VAT and the total: only the full billing screen
      // computes it. The draft must not promise an amount that would then differ.
      throw new AssistantTools.ToolException("CLIENT_REQUIRES_MANUAL_INVOICE");
    }
    Map<Long, ServiceResponse> catalog = catalogById(tenantId);
    Map<Long, ProfessionalOptionResponse> professionals = professionalsById(tenantId);
    ProfessionalOptionResponse professional = null;
    if (req.professionalId() != null) {
      professional = professionals.get(req.professionalId());
      if (professional == null || !professional.active()) {
        throw new AssistantTools.ToolException("PROFESSIONAL_NOT_FOUND");
      }
    }

    List<Line> lines;
    Long recordId = null;
    Long appointmentId = null;
    if (req.serviceIds() != null && !req.serviceIds().isEmpty()) {
      lines = catalogLines(req.serviceIds(), catalog, professional);
    } else if (req.appointmentId() != null) {
      AppointmentResponse a = appointmentService.get(tenantId, req.appointmentId());
      lines = List.of(appointmentLine(a, catalog, professionals));
      appointmentId = a.id();
      requireNotInvoiced(tenantId, a);
    } else {
      Optional<ServiceRecord> record = openRecord(tenantId, client.id());
      if (record.isPresent()) {
        recordId = record.get().getId();
        lines = recordLines(record.get(), catalog);
      } else {
        AppointmentResponse today = singleAppointmentOfToday(tenantId, client.id());
        lines = List.of(appointmentLine(today, catalog, professionals));
        appointmentId = today.id();
      }
    }
    boolean identified = hasIdentity(client);
    String email = blankToNull(req.email());
    if (email == null) {
      email = blankToNull(client.email());
    }
    if (email != null && !EmailFormatValidator.isValid(email)) {
      email = null;
    }
    String method = normalizeMethod(req.paymentMethod());
    return new InvoiceDraftPayload(
        client.id(),
        client.fullName(),
        identified,
        lines,
        recordId,
        appointmentId,
        method,
        null,
        email,
        total(lines));
  }

  /**
   * The same draft re-priced from the catalog / record NOW, keeping what the person completed. The
   * caller compares {@link #fingerprint} to know whether anything the draft was priced against
   * changed since it was proposed.
   */
  public InvoiceDraftPayload reprice(long tenantId, InvoiceDraftPayload old) {
    Map<Long, ServiceResponse> catalog = catalogById(tenantId);
    Map<Long, ProfessionalOptionResponse> professionals = professionalsById(tenantId);
    List<Line> lines;
    if (old.serviceRecordId() != null) {
      ServiceRecord record =
          serviceRecordRepository
              .findByIdAndTenant_Id(old.serviceRecordId(), tenantId)
              .orElseThrow(() -> new AssistantTools.ToolException("SERVICE_RECORD_NOT_FOUND"));
      if (record.getStatus() != ServiceRecordStatus.OPEN
          || invoiceRepository.existsByServiceRecord_Id(record.getId())) {
        throw new AssistantTools.ToolException("SERVICE_RECORD_NOT_OPEN");
      }
      lines = recordLines(record, catalog);
    } else if (old.appointmentId() != null) {
      AppointmentResponse a = appointmentService.get(tenantId, old.appointmentId());
      requireNotInvoiced(tenantId, a);
      lines = List.of(appointmentLine(a, catalog, professionals));
    } else {
      List<Line> repriced = new ArrayList<>();
      for (Line l : old.lines()) {
        ServiceResponse s = catalog.get(l.serviceId());
        if (s == null || !s.active()) {
          throw new AssistantTools.ToolException("SERVICE_NOT_FOUND");
        }
        repriced.add(
            line(s, l.quantity(), s.priceMinor(), l.professionalId(), l.professionalName()));
      }
      lines = repriced;
    }
    lines = keepEditedPrices(old.lines(), lines);
    return old.withLines(lines, total(lines));
  }

  /**
   * A price the person typed on the card stays: re-pricing only refreshes what they did not touch
   * (so a catalog change never overwrites their edit, and never raises a false «price changed»).
   */
  private static List<Line> keepEditedPrices(List<Line> old, List<Line> fresh) {
    List<Line> out = new ArrayList<>();
    for (int i = 0; i < fresh.size(); i++) {
      Line f = fresh.get(i);
      Line o = i < old.size() ? old.get(i) : null;
      boolean sameLine =
          o != null
              && Boolean.TRUE.equals(o.priceEdited())
              && Objects.equals(o.serviceId(), f.serviceId())
              && o.quantity() == f.quantity();
      out.add(
          sameLine ? f.withEditedPrice(o.unitPrice(), lineTotal(o.unitPrice(), f.quantity())) : f);
    }
    return out;
  }

  /** Fingerprint of what the draft charges and at what price (not of payment or e-mail). */
  public static String fingerprint(InvoiceDraftPayload p) {
    StringBuilder sb = new StringBuilder();
    sb.append(p.clientId())
        .append('|')
        .append(p.serviceRecordId())
        .append('|')
        .append(p.appointmentId());
    for (Line l : p.lines()) {
      sb.append('|')
          .append(l.serviceId())
          .append(':')
          .append(l.quantity())
          .append(':')
          .append(l.unitPrice() == null ? "" : l.unitPrice().stripTrailingZeros().toPlainString())
          .append(':')
          .append(l.professionalId());
    }
    try {
      byte[] digest =
          MessageDigest.getInstance("SHA-256")
              .digest(sb.toString().getBytes(StandardCharsets.UTF_8));
      return HexFormat.of().formatHex(digest);
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException(e);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // What is missing, completing, and the request

  /** What the person has to complete before confirming. */
  public List<String> missing(long tenantId, InvoiceDraftPayload p) {
    List<String> missing = new ArrayList<>();
    if (p.paymentMethod() == null) {
      missing.add("PAYMENT_METHOD");
    } else if (isCard(p.paymentMethod()) && p.cardBrand() == null) {
      missing.add("CARD_BRAND");
    }
    // SIFEN mails the KuDE after approval: an identified receiver needs an address (issue #173).
    if (p.email() == null && p.receiverIdentified() && emissionService.isSifenEnabled(tenantId)) {
      missing.add("EMAIL");
    }
    return missing;
  }

  /** Same as the full version, with no unit-price edits. */
  public InvoiceDraftPayload complete(
      InvoiceDraftPayload p, String paymentMethod, String cardBrand, String email) {
    return complete(p, paymentMethod, cardBrand, email, null);
  }

  /** Applies what the card sends ({@code PATCH}); validates every value. */
  public InvoiceDraftPayload complete(
      InvoiceDraftPayload p,
      String paymentMethod,
      String cardBrand,
      String email,
      List<AssistantDraftService.LinePrice> linePrices) {
    InvoiceDraftPayload out = applyLinePrices(p, linePrices);
    if (paymentMethod != null) {
      String method = normalizeMethod(paymentMethod);
      if (method == null) {
        throw new AssistantDraftException(
            org.springframework.http.HttpStatus.BAD_REQUEST, "ASSISTANT_DRAFT_INVALID_PAYMENT");
      }
      out = out.withPayment(method, isCard(method) ? out.cardBrand() : null);
    }
    if (cardBrand != null) {
      String brand = cardBrand.trim().toUpperCase();
      if (!CARD_BRANDS.contains(brand)
          || out.paymentMethod() == null
          || !isCard(out.paymentMethod())) {
        throw new AssistantDraftException(
            org.springframework.http.HttpStatus.BAD_REQUEST, "ASSISTANT_DRAFT_INVALID_PAYMENT");
      }
      out = out.withPayment(out.paymentMethod(), brand);
    }
    if (email != null) {
      String trimmed = email.trim();
      if (!trimmed.isEmpty() && !EmailFormatValidator.isValid(trimmed)) {
        throw new AssistantDraftException(
            org.springframework.http.HttpStatus.BAD_REQUEST, "ASSISTANT_DRAFT_INVALID_EMAIL");
      }
      out = out.withEmail(trimmed.isEmpty() ? null : trimmed);
    }
    return out;
  }

  /**
   * The person edits unit prices on the card, like the billing screen allows. Whole guaraníes,
   * greater than zero; the totals are recalculated here (the card never sends a total).
   */
  private static InvoiceDraftPayload applyLinePrices(
      InvoiceDraftPayload p, List<AssistantDraftService.LinePrice> linePrices) {
    if (linePrices == null || linePrices.isEmpty()) {
      return p;
    }
    List<Line> lines = new ArrayList<>(p.lines());
    for (AssistantDraftService.LinePrice change : linePrices) {
      BigDecimal price = change.unitPrice();
      if (change.index() == null
          || change.index() < 0
          || change.index() >= lines.size()
          || price == null
          || price.signum() <= 0
          || price.stripTrailingZeros().scale() > 0
          || price.compareTo(MAX_UNIT_PRICE) > 0) {
        throw new AssistantDraftException(
            org.springframework.http.HttpStatus.BAD_REQUEST, "ASSISTANT_DRAFT_INVALID_PRICE");
      }
      Line l = lines.get(change.index());
      BigDecimal whole = price.setScale(0, RoundingMode.UNNECESSARY);
      lines.set(change.index(), l.withEditedPrice(whole, lineTotal(whole, l.quantity())));
    }
    return p.withLines(lines, total(lines));
  }

  /**
   * The request the regular invoicing road receives. The receiver identity is resolved like the
   * billing screen does (an explicit document type wins; else RUC; else cédula; else «sin
   * identificar») from the client's CURRENT data.
   */
  public InvoiceCreateRequest toRequest(long tenantId, InvoiceDraftPayload p) {
    ClientResponse client = clientService.getById(tenantId, p.clientId());
    String ruc = null;
    String document = null;
    String documentType = null;
    String taxpayer = null;
    ClientIdentityDocumentType type = resolveType(client);
    if (type == ClientIdentityDocumentType.RUC && !isBlank(client.ruc())) {
      ruc = client.ruc();
      taxpayer = client.taxpayerType();
    } else if (type != ClientIdentityDocumentType.INNOMINADO
        && type != ClientIdentityDocumentType.RUC
        && !isBlank(client.identityDocumentNumber())) {
      document = client.identityDocumentNumber();
      documentType = type.name();
    }
    List<InvoiceLineRequest> lines = new ArrayList<>();
    for (Line l : p.lines()) {
      lines.add(
          new InvoiceLineRequest(
              l.serviceId(),
              l.name(),
              l.quantity(),
              l.unitPrice(),
              null,
              null,
              l.professionalId()));
    }
    List<InvoicePaymentAllocationRequest> payments =
        List.of(
            new InvoicePaymentAllocationRequest(
                p.paymentMethod(),
                p.total(),
                isCard(p.paymentMethod()) ? p.cardBrand() : null,
                null));
    return new InvoiceCreateRequest(
        client.id(),
        client.fullName(),
        ruc,
        document,
        null,
        null,
        lines,
        payments,
        p.serviceRecordId(),
        null,
        documentType,
        taxpayer,
        p.email(),
        null,
        null,
        p.appointmentId());
  }

  // ---------------------------------------------------------------------------------------------

  private Optional<ServiceRecord> openRecord(long tenantId, long clientId) {
    return serviceRecordRepository
        .findByTenantAndClientAndStatusWithLines(tenantId, clientId, ServiceRecordStatus.OPEN)
        .stream()
        .filter(r -> !r.getLines().isEmpty())
        .filter(r -> !invoiceRepository.existsByServiceRecord_Id(r.getId()))
        .max(Comparator.comparing(ServiceRecord::getCreatedAt));
  }

  /** The client's appointment of today that can be charged; several or none are reported. */
  private AppointmentResponse singleAppointmentOfToday(long tenantId, long clientId) {
    ZoneId zone = timeProperties.zoneId();
    LocalDate today = LocalDate.now(zone);
    Instant from = today.atStartOfDay(zone).toInstant();
    Instant to = today.plusDays(1).atStartOfDay(zone).toInstant();
    List<AppointmentResponse> candidates =
        appointmentService.list(tenantId, from, to, null, clientId).stream()
            .filter(a -> !"CANCELLED".equals(a.status()) && !"NO_SHOW".equals(a.status()))
            .filter(a -> a.invoiceId() == null)
            .toList();
    if (candidates.isEmpty()) {
      throw new AssistantTools.ToolException("NOTHING_TO_INVOICE");
    }
    if (candidates.size() > 1) {
      List<Map<String, Object>> options = new ArrayList<>();
      for (AppointmentResponse a : candidates) {
        Map<String, Object> o = new LinkedHashMap<>();
        o.put("appointmentId", a.id());
        o.put("start", Instant.parse(a.startAt()).atZone(zone).toLocalTime().toString());
        o.put("serviceName", a.serviceName());
        options.add(o);
      }
      throw new AssistantTools.ToolException(
          "MULTIPLE_APPOINTMENTS", Map.of("appointments", options));
    }
    return candidates.get(0);
  }

  private void requireNotInvoiced(long tenantId, AppointmentResponse a) {
    if (a.invoiceId() != null) {
      throw new AssistantTools.ToolException("APPOINTMENT_ALREADY_INVOICED");
    }
    if ("CANCELLED".equals(a.status()) || "NO_SHOW".equals(a.status())) {
      throw new AssistantTools.ToolException("NOTHING_TO_INVOICE");
    }
  }

  private List<Line> catalogLines(
      List<Long> ids, Map<Long, ServiceResponse> catalog, ProfessionalOptionResponse professional) {
    Map<Long, Integer> quantities = new LinkedHashMap<>();
    for (Long id : ids) {
      quantities.merge(id, 1, Integer::sum);
    }
    List<Line> lines = new ArrayList<>();
    for (Map.Entry<Long, Integer> e : quantities.entrySet()) {
      ServiceResponse s = catalog.get(e.getKey());
      if (s == null || !s.active()) {
        throw new AssistantTools.ToolException("SERVICE_NOT_FOUND");
      }
      lines.add(
          line(
              s,
              e.getValue(),
              s.priceMinor(),
              professional == null ? null : professional.id(),
              professional == null ? null : professional.displayName()));
    }
    return lines;
  }

  private List<Line> recordLines(ServiceRecord record, Map<Long, ServiceResponse> catalog) {
    List<Line> lines = new ArrayList<>();
    for (ServiceRecordLine l : record.getLines()) {
      ServiceResponse s =
          l.getSalonService() == null ? null : catalog.get(l.getSalonService().getId());
      // A ficha line stores 0 when nobody priced it (an explicit price must be > 0): that means
      // «the catalog's price», exactly what the billing screen shows for it.
      BigDecimal unit =
          l.getUnitPrice() != null && l.getUnitPrice().signum() > 0
              ? l.getUnitPrice()
              : s == null ? BigDecimal.ZERO : s.priceMinor();
      int qty = l.getQuantity() == null ? 1 : l.getQuantity();
      String name =
          l.getDescription() != null && !l.getDescription().isBlank()
              ? l.getDescription()
              : s != null ? s.name() : "—";
      lines.add(
          new Line(
              s == null ? null : s.id(),
              name,
              qty,
              unit,
              lineTotal(unit, qty),
              l.getProfessional() == null ? null : l.getProfessional().getId(),
              l.getProfessional() == null ? null : l.getProfessional().getDisplayName(),
              null));
    }
    return lines;
  }

  private Line appointmentLine(
      AppointmentResponse a,
      Map<Long, ServiceResponse> catalog,
      Map<Long, ProfessionalOptionResponse> professionals) {
    ServiceResponse s = catalog.get(a.serviceId());
    if (s == null) {
      throw new AssistantTools.ToolException("SERVICE_NOT_FOUND");
    }
    ProfessionalOptionResponse p = professionals.get(a.professionalId());
    return line(
        s,
        1,
        s.priceMinor(),
        a.professionalId(),
        p != null ? p.displayName() : a.professionalName());
  }

  private static Line line(
      ServiceResponse s, int qty, BigDecimal unit, Long professionalId, String professionalName) {
    return new Line(
        s.id(), s.name(), qty, unit, lineTotal(unit, qty), professionalId, professionalName, null);
  }

  private static BigDecimal lineTotal(BigDecimal unit, int qty) {
    return unit.multiply(BigDecimal.valueOf(qty)).setScale(0, RoundingMode.HALF_UP);
  }

  private static BigDecimal total(List<Line> lines) {
    return lines.stream().map(Line::lineTotal).reduce(BigDecimal.ZERO, BigDecimal::add);
  }

  private Map<Long, ServiceResponse> catalogById(long tenantId) {
    Map<Long, ServiceResponse> map = new LinkedHashMap<>();
    for (ServiceResponse s :
        catalogService.listServices(tenantId, Optional.empty(), null, "SERVICE")) {
      map.put(s.id(), s);
    }
    return map;
  }

  private Map<Long, ProfessionalOptionResponse> professionalsById(long tenantId) {
    Map<Long, ProfessionalOptionResponse> map = new LinkedHashMap<>();
    for (ProfessionalOptionResponse p : professionalService.listOptions(tenantId)) {
      map.put(p.id(), p);
    }
    return map;
  }

  private static boolean hasIdentity(ClientResponse c) {
    return !isBlank(c.ruc()) || !isBlank(c.identityDocumentNumber());
  }

  /** Same resolution as the billing screen's {@code resolveIdentityDocumentTypeAndNumber}. */
  private static ClientIdentityDocumentType resolveType(ClientResponse c) {
    if (!isBlank(c.identityDocumentType())) {
      try {
        return ClientIdentityDocumentType.valueOf(c.identityDocumentType());
      } catch (IllegalArgumentException ignored) {
        // fall through to the implicit detection
      }
    }
    if (!isBlank(c.ruc())) {
      return ClientIdentityDocumentType.RUC;
    }
    if (!isBlank(c.identityDocumentNumber())) {
      return ClientIdentityDocumentType.CEDULA_PARAGUAYA;
    }
    return ClientIdentityDocumentType.INNOMINADO;
  }

  private static String normalizeMethod(String raw) {
    if (raw == null || raw.isBlank()) {
      return null;
    }
    String m = raw.trim().toUpperCase();
    return PAYMENT_METHODS.contains(m) ? m : null;
  }

  private static boolean isCard(String method) {
    return PaymentMethod.DEBIT_CARD.name().equals(method)
        || PaymentMethod.CREDIT_CARD.name().equals(method);
  }

  private static boolean isBlank(String s) {
    return s == null || s.isBlank();
  }

  private static String blankToNull(String s) {
    return isBlank(s) ? null : s.trim();
  }
}
