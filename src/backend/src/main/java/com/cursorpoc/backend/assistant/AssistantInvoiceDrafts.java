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

  /**
   * What the model asked to invoice. All optional but {@code clientId}. {@code prices} are unit
   * prices (by service id) the PERSON said in the message: they arrive on the card already as
   * edited, editable prices.
   */
  public record Request(
      Long clientId,
      List<Long> serviceIds,
      Long professionalId,
      Long appointmentId,
      String paymentMethod,
      String email,
      Map<Long, BigDecimal> prices) {

    public Request(
        Long clientId,
        List<Long> serviceIds,
        Long professionalId,
        Long appointmentId,
        String paymentMethod,
        String email) {
      this(clientId, serviceIds, professionalId, appointmentId, paymentMethod, email, null);
    }
  }

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
    lines = applyRequestedPrices(lines, req.prices());
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
        total(lines),
        List.of());
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
      lines = withoutDropped(recordLines(record, catalog), old);
    } else if (old.appointmentId() != null) {
      AppointmentResponse a = appointmentService.get(tenantId, old.appointmentId());
      requireNotInvoiced(tenantId, a);
      lines = withoutDropped(List.of(appointmentLine(a, catalog, professionals)), old);
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
    if (old.serviceRecordId() != null || old.appointmentId() != null) {
      // Items added on top of the ficha / appointment are not in it: they stay, at today's price.
      lines = new ArrayList<>(lines);
      lines.addAll(addedLines(old, catalog));
      if (lines.isEmpty()) {
        throw new AssistantTools.ToolException("NOTHING_TO_INVOICE");
      }
    }
    lines = keepEditedPrices(old.lines(), lines);
    return old.withLines(lines, total(lines));
  }

  /** The lines of the source (ficha / appointment) the person did not drop from the card. */
  private static List<Line> withoutDropped(List<Line> source, InvoiceDraftPayload old) {
    List<Long> dropped = old.removedSourceIds() == null ? List.of() : old.removedSourceIds();
    return source.stream().filter(l -> !dropped.contains(l.sourceId())).toList();
  }

  /** Catalog items added to a ficha / appointment draft, priced from the catalog NOW. */
  private static List<Line> addedLines(
      InvoiceDraftPayload old, Map<Long, ServiceResponse> catalog) {
    List<Line> out = new ArrayList<>();
    for (Line l : old.lines()) {
      if (l.sourceId() != null) {
        continue;
      }
      ServiceResponse s = catalog.get(l.serviceId());
      if (s == null || !s.active()) {
        throw new AssistantTools.ToolException("SERVICE_NOT_FOUND");
      }
      out.add(line(s, l.quantity(), s.priceMinor(), l.professionalId(), l.professionalName()));
    }
    return out;
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

  /** A catalog item (service or product) to add, and how many. */
  public record NewItem(Long id, int quantity) {}

  static final int MAX_QUANTITY = 99;

  /**
   * The draft with more items on it. It keeps what the person already did on the card (prices they
   * typed, items they dropped, payment, e-mail): an item already there (same catalog item, same
   * professional, not from the ficha) gets a larger quantity at its current unit price; anything
   * else is a new line at the catalog's price, or at the price the person said.
   *
   * @param professionalId optional; without it the new items take the professional every line of
   *     the draft already shares, if any
   */
  public InvoiceDraftPayload addItems(
      long tenantId,
      InvoiceDraftPayload old,
      List<NewItem> items,
      Long professionalId,
      Map<Long, BigDecimal> prices) {
    if (items == null || items.isEmpty()) {
      throw new AssistantTools.ToolException("ITEMS_REQUIRED");
    }
    Map<Long, ServiceResponse> catalog = catalogById(tenantId);
    Long proId = professionalId;
    String proName = null;
    if (proId != null) {
      ProfessionalOptionResponse p = professionalsById(tenantId).get(proId);
      if (p == null || !p.active()) {
        throw new AssistantTools.ToolException("PROFESSIONAL_NOT_FOUND");
      }
      proName = p.displayName();
    } else {
      Line shared = sharedProfessional(old.lines());
      if (shared != null) {
        proId = shared.professionalId();
        proName = shared.professionalName();
      }
    }
    List<Line> lines = new ArrayList<>(old.lines());
    for (NewItem item : items) {
      if (item.id() == null || item.quantity() < 1 || item.quantity() > MAX_QUANTITY) {
        throw new AssistantTools.ToolException("INVALID_ARGUMENTS");
      }
      ServiceResponse s = catalog.get(item.id());
      if (s == null || !s.active()) {
        throw new AssistantTools.ToolException("SERVICE_NOT_FOUND");
      }
      int at = -1;
      for (int i = 0; i < lines.size() && at < 0; i++) {
        Line l = lines.get(i);
        if (item.id().equals(l.serviceId())
            && l.sourceId() == null
            && Objects.equals(l.professionalId(), proId)) {
          at = i;
        }
      }
      if (at >= 0) {
        Line l = lines.get(at);
        int quantity = l.quantity() + item.quantity();
        if (quantity > MAX_QUANTITY) {
          throw new AssistantTools.ToolException("INVALID_ARGUMENTS");
        }
        lines.set(at, l.withQuantity(quantity, lineTotal(l.unitPrice(), quantity)));
      } else {
        lines.add(line(s, item.quantity(), s.priceMinor(), proId, proName));
      }
    }
    lines = applyRequestedPrices(lines, prices);
    return old.withLines(lines, total(lines));
  }

  /** A line carrying the one professional that every line of the draft has, if there is one. */
  private static Line sharedProfessional(List<Line> lines) {
    Line first = lines.isEmpty() ? null : lines.get(0);
    if (first == null || first.professionalId() == null) {
      return null;
    }
    for (Line l : lines) {
      if (!first.professionalId().equals(l.professionalId())) {
        return null;
      }
    }
    return first;
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

  /** Same as the full version, with no line removals. */
  public InvoiceDraftPayload complete(
      InvoiceDraftPayload p,
      String paymentMethod,
      String cardBrand,
      String email,
      List<AssistantDraftService.LinePrice> linePrices) {
    return complete(p, paymentMethod, cardBrand, email, linePrices, null);
  }

  /**
   * Applies what the card sends ({@code PATCH}); validates every value. Prices and removals both
   * refer to the lines as the card shows them, so prices go first and removals after.
   */
  public InvoiceDraftPayload complete(
      InvoiceDraftPayload p,
      String paymentMethod,
      String cardBrand,
      String email,
      List<AssistantDraftService.LinePrice> linePrices,
      List<Integer> removeLines) {
    InvoiceDraftPayload out = applyLinePrices(p, linePrices);
    out = applyRemovals(out, removeLines);
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

  /** A unit price is valid when it is a whole number of guaraníes, above zero and sane. */
  private static boolean isValidUnitPrice(BigDecimal price) {
    return price != null
        && price.signum() > 0
        && price.stripTrailingZeros().scale() <= 0
        && price.compareTo(MAX_UNIT_PRICE) <= 0;
  }

  /**
   * Prices the person gave in the message: they replace the catalog's for the lines of that service
   * and arrive marked as edited. A price for a service that is not on the invoice, or an invalid
   * one, is reported so the assistant can ask again instead of guessing.
   */
  private static List<Line> applyRequestedPrices(List<Line> lines, Map<Long, BigDecimal> prices) {
    if (prices == null || prices.isEmpty()) {
      return lines;
    }
    for (Map.Entry<Long, BigDecimal> e : prices.entrySet()) {
      if (e.getKey() == null || !isValidUnitPrice(e.getValue())) {
        throw new AssistantTools.ToolException("INVALID_PRICE");
      }
      if (lines.stream().noneMatch(l -> e.getKey().equals(l.serviceId()))) {
        throw new AssistantTools.ToolException("PRICE_SERVICE_NOT_IN_INVOICE");
      }
    }
    List<Line> out = new ArrayList<>();
    for (Line l : lines) {
      BigDecimal price = l.serviceId() == null ? null : prices.get(l.serviceId());
      if (price == null) {
        out.add(l);
      } else {
        BigDecimal whole = price.setScale(0, RoundingMode.UNNECESSARY);
        out.add(l.withEditedPrice(whole, lineTotal(whole, l.quantity())));
      }
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
          || !isValidUnitPrice(price)) {
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
   * The person drops items from the card. At least one must stay (an invoice without items does not
   * exist: to give it up, discard the draft). A line that comes from the ficha is remembered, so
   * re-pricing from the ficha does not bring it back.
   */
  private static InvoiceDraftPayload applyRemovals(InvoiceDraftPayload p, List<Integer> indexes) {
    if (indexes == null || indexes.isEmpty()) {
      return p;
    }
    java.util.Set<Integer> drop = new java.util.LinkedHashSet<>();
    for (Integer i : indexes) {
      if (i == null || i < 0 || i >= p.lines().size() || !drop.add(i)) {
        throw new AssistantDraftException(
            org.springframework.http.HttpStatus.BAD_REQUEST, "ASSISTANT_DRAFT_INVALID_LINE");
      }
    }
    if (drop.size() >= p.lines().size()) {
      throw new AssistantDraftException(
          org.springframework.http.HttpStatus.BAD_REQUEST, "ASSISTANT_DRAFT_LAST_LINE");
    }
    List<Line> kept = new ArrayList<>();
    List<Long> removedIds =
        new ArrayList<>(p.removedSourceIds() == null ? List.of() : p.removedSourceIds());
    for (int i = 0; i < p.lines().size(); i++) {
      Line l = p.lines().get(i);
      if (!drop.contains(i)) {
        kept.add(l);
      } else if (l.sourceId() != null) {
        removedIds.add(l.sourceId());
      }
    }
    return p.withoutLines(kept, total(kept), removedIds);
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
              null,
              l.getId()));
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
            p != null ? p.displayName() : a.professionalName())
        .withSource(a.id());
  }

  private static Line line(
      ServiceResponse s, int qty, BigDecimal unit, Long professionalId, String professionalName) {
    return new Line(
        s.id(),
        s.name(),
        qty,
        unit,
        lineTotal(unit, qty),
        professionalId,
        professionalName,
        null,
        null);
  }

  private static BigDecimal lineTotal(BigDecimal unit, int qty) {
    return unit.multiply(BigDecimal.valueOf(qty)).setScale(0, RoundingMode.HALF_UP);
  }

  private static BigDecimal total(List<Line> lines) {
    return lines.stream().map(Line::lineTotal).reduce(BigDecimal.ZERO, BigDecimal::add);
  }

  private Map<Long, ServiceResponse> catalogById(long tenantId) {
    Map<Long, ServiceResponse> map = new LinkedHashMap<>();
    for (ServiceResponse s : catalogService.listServices(tenantId, Optional.empty(), null, null)) {
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
