package com.cursorpoc.backend.assistant;

import com.cursorpoc.backend.assistant.AssistantDraftPayloads.ServiceRecordDraftPayload;
import com.cursorpoc.backend.assistant.AssistantDraftPayloads.ServiceRecordDraftPayload.Change;
import com.cursorpoc.backend.assistant.AssistantDraftPayloads.ServiceRecordDraftPayload.Line;
import com.cursorpoc.backend.assistant.AssistantDraftPayloads.ServiceRecordDraftPayload.LineKey;
import com.cursorpoc.backend.assistant.AssistantDraftPayloads.ServiceRecordDraftPayload.NotApplied;
import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.ServiceRecord;
import com.cursorpoc.backend.domain.ServiceRecordLine;
import com.cursorpoc.backend.domain.enums.ServiceRecordStatus;
import com.cursorpoc.backend.repository.ServiceRecordRepository;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.service.AppointmentService;
import com.cursorpoc.backend.service.AppointmentServiceRecordService;
import com.cursorpoc.backend.service.ClientService;
import com.cursorpoc.backend.service.ProfessionalDirectoryService;
import com.cursorpoc.backend.service.ServiceCatalogService;
import com.cursorpoc.backend.service.ServiceRecordService;
import com.cursorpoc.backend.web.dto.AppointmentResponse;
import com.cursorpoc.backend.web.dto.ClientResponse;
import com.cursorpoc.backend.web.dto.ProfessionalOptionResponse;
import com.cursorpoc.backend.web.dto.ServiceRecordLineRequest;
import com.cursorpoc.backend.web.dto.ServiceRecordRequest;
import com.cursorpoc.backend.web.dto.ServiceRecordTipRequest;
import com.cursorpoc.backend.web.dto.ServiceRecordTipResponse;
import com.cursorpoc.backend.web.dto.ServiceResponse;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
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
import org.springframework.transaction.annotation.Transactional;

/**
 * What a ficha de servicio draft would do, for each role, and the services it becomes when the
 * person presses «Guardar ficha». Nothing is written here until {@link #commit}.
 *
 * <p>The model sends only CHANGES (add / remove / change); the state they apply to is read here
 * (the saved ficha, the turno's line, or the pending draft). A professional never gets a money
 * amount: the payload is built without them and the services she uses ignore prices anyway.
 */
@Component
public class AssistantRecordDrafts {

  static final int MAX_QUANTITY = 99;
  private static final Set<String> LINKABLE = Set.of("PENDING", "CONFIRMED", "IN_PROGRESS");
  private static final DateTimeFormatter HH_MM = DateTimeFormatter.ofPattern("HH:mm");

  private final ClientService clientService;
  private final ServiceCatalogService catalogService;
  private final ProfessionalDirectoryService professionalDirectoryService;
  private final AppointmentService appointmentService;
  private final ServiceRecordRepository recordRepository;
  private final ServiceRecordService recordService;
  private final AppointmentServiceRecordService appointmentRecordService;
  private final FemmeTimeProperties timeProperties;

  public AssistantRecordDrafts(
      ClientService clientService,
      ServiceCatalogService catalogService,
      ProfessionalDirectoryService professionalDirectoryService,
      AppointmentService appointmentService,
      ServiceRecordRepository recordRepository,
      ServiceRecordService recordService,
      AppointmentServiceRecordService appointmentRecordService,
      FemmeTimeProperties timeProperties) {
    this.clientService = clientService;
    this.catalogService = catalogService;
    this.professionalDirectoryService = professionalDirectoryService;
    this.appointmentService = appointmentService;
    this.recordRepository = recordRepository;
    this.recordService = recordService;
    this.appointmentRecordService = appointmentRecordService;
    this.timeProperties = timeProperties;
  }

  /** One item to add: a catalog id (service or product), how many, and what the person said. */
  public record Add(Long id, int quantity, Long professionalId, BigDecimal unitPrice) {}

  /** Changes to the line at {@code position} of the list the person sees. */
  public record ChangeReq(
      int position, Integer quantity, Long professionalId, BigDecimal unitPrice) {}

  /**
   * What the model asked for. {@code remove} and {@code change} positions are the ones of the list
   * the person sees: the pending draft's when there is one, the saved ficha's otherwise.
   */
  public record Request(
      Long clientId,
      Long appointmentId,
      Long recordId,
      boolean newRecord,
      List<Add> add,
      List<Integer> remove,
      List<ChangeReq> change) {}

  // ---------------------------------------------------------------------------------------------
  // Working state

  /** One line while changes are applied. */
  private static final class W {
    Long serviceId;
    String name;
    int quantity;
    BigDecimal unit;
    Long professionalId;
    String professionalName;
    boolean isNew;
    boolean changed;

    W copy() {
      W c = new W();
      c.serviceId = serviceId;
      c.name = name;
      c.quantity = quantity;
      c.unit = unit;
      c.professionalId = professionalId;
      c.professionalName = professionalName;
      c.isNew = isNew;
      c.changed = changed;
      return c;
    }
  }

  /** What the changes apply to: where it will be saved and the lines as they are saved now. */
  private record Base(
      Long recordId,
      Long appointmentId,
      String appointmentTime,
      List<W> lines,
      String fingerprint) {}

  private record Catalog(
      Map<Long, ServiceResponse> items, Map<Long, ProfessionalOptionResponse> pros) {}

  // ---------------------------------------------------------------------------------------------
  // Building a draft

  // A ficha's lines are lazy: reading them needs a session, and the tools call this from a worker
  // thread with none. The read-only transaction covers the whole build.
  @Transactional(readOnly = true)
  public ServiceRecordDraftPayload build(
      AssistantContext ctx, Request req, Optional<ServiceRecordDraftPayload> pending) {
    if (req.clientId() == null) {
      throw new AssistantTools.ToolException("CLIENT_REQUIRED");
    }
    ClientResponse client = clientService.getById(ctx.tenantId(), req.clientId());
    Catalog catalog = catalog(ctx.tenantId());
    validate(ctx, req, catalog);

    // The pending card is the base only when the request does not point somewhere else: a new
    // ficha, another ficha or another turno means the person moved on from it.
    ServiceRecordDraftPayload samePending =
        pending
            .filter(p -> Objects.equals(p.clientId(), client.id()))
            .filter(
                p ->
                    !req.newRecord()
                        && (req.recordId() == null || req.recordId().equals(p.serviceRecordId()))
                        && (req.appointmentId() == null
                            || req.appointmentId().equals(p.appointmentId())))
            .orElse(null);
    Base base = null;
    List<Change> earlier = List.of();
    List<Line> refLines = List.of();
    if (samePending != null) {
      try {
        base =
            baseOf(
                ctx,
                samePending.serviceRecordId(),
                samePending.appointmentId(),
                samePending.clientId(),
                catalog);
        earlier = samePending.changes();
        refLines = samePending.lines().stream().filter(l -> !"REMOVED".equals(l.mark())).toList();
      } catch (AssistantTools.ToolException gone) {
        // What the pending card was built on is gone (its ficha was closed or voided): it can no
        // longer be the base, so this proposal starts fresh instead of failing for good.
        base = null;
      }
    }
    if (base == null) {
      base = resolveBase(ctx, req, client, catalog);
      refLines = linesOf(base.lines(), ctx.isAdmin());
    }

    List<Change> changes = new ArrayList<>(earlier);
    changes.addAll(toChanges(ctx, req, refLines));
    ServiceRecordDraftPayload result =
        assemble(ctx, client.id(), client.fullName(), base, changes, catalog);
    if (result.lines().stream().noneMatch(l -> !"REMOVED".equals(l.mark()))) {
      throw new AssistantTools.ToolException("NOTHING_TO_SAVE");
    }
    return result;
  }

  /** The same draft with its changes applied again on the ficha as it is NOW. */
  @Transactional(readOnly = true)
  public ServiceRecordDraftPayload rebase(AssistantContext ctx, ServiceRecordDraftPayload old) {
    Catalog catalog = catalog(ctx.tenantId());
    Base base = baseOf(ctx, old.serviceRecordId(), old.appointmentId(), old.clientId(), catalog);
    ServiceRecordDraftPayload result =
        assemble(ctx, old.clientId(), old.clientName(), base, old.changes(), catalog);
    if (result.lines().stream().noneMatch(l -> !"REMOVED".equals(l.mark()))) {
      throw new AssistantTools.ToolException("NOTHING_TO_SAVE");
    }
    return result;
  }

  private void validate(AssistantContext ctx, Request req, Catalog catalog) {
    for (Add a : adds(req)) {
      checkQuantity(a.quantity());
      checkPrice(ctx, a.unitPrice());
      checkProfessional(a.professionalId(), catalog);
    }
    for (ChangeReq c : changes(req)) {
      if (c.quantity() != null) {
        checkQuantity(c.quantity());
      }
      checkPrice(ctx, c.unitPrice());
      checkProfessional(c.professionalId(), catalog);
    }
  }

  private static void checkQuantity(int q) {
    if (q < 1 || q > MAX_QUANTITY) {
      throw new AssistantTools.ToolException("INVALID_ARGUMENTS");
    }
  }

  private static void checkPrice(AssistantContext ctx, BigDecimal price) {
    if (price == null) {
      return;
    }
    if (!ctx.isAdmin()) {
      throw new AssistantTools.ToolException("PRICE_NOT_ALLOWED");
    }
    if (price.signum() <= 0) {
      throw new AssistantTools.ToolException("INVALID_PRICE");
    }
  }

  private static void checkProfessional(Long id, Catalog catalog) {
    if (id == null) {
      return;
    }
    ProfessionalOptionResponse p = catalog.pros().get(id);
    if (p == null || !p.active()) {
      throw new AssistantTools.ToolException("PROFESSIONAL_NOT_FOUND");
    }
  }

  private static List<Add> adds(Request req) {
    return req.add() == null ? List.of() : req.add();
  }

  private static List<ChangeReq> changes(Request req) {
    return req.change() == null ? List.of() : req.change();
  }

  /** A line of the list the person sees, followed through this request's own operations. */
  private static final class Slot {
    Long serviceId;
    Long professionalId;

    Slot(Long serviceId, Long professionalId) {
      this.serviceId = serviceId;
      this.professionalId = professionalId;
    }
  }

  /**
   * The request as ordered changes with stable keys: CHANGEs, then REMOVEs from the last position
   * back, then ADDs. Each key is computed against the lines as the EARLIER operations of this same
   * request leave them (a change that moves a line to another professional changes what a later key
   * must say), so replaying the changes one after another always lands on the right line.
   */
  private List<Change> toChanges(AssistantContext ctx, Request req, List<Line> refLines) {
    List<Slot> slots = new ArrayList<>();
    for (Line l : refLines) {
      slots.add(new Slot(l.serviceId(), l.professionalId()));
    }
    List<Slot> original = List.copyOf(slots);
    List<Change> out = new ArrayList<>();
    for (ChangeReq c : changes(req)) {
      Slot slot = slotAt(original, c.position());
      out.add(
          new Change(
              "CHANGE", keyOf(slots, slot), null, c.quantity(), c.professionalId(), c.unitPrice()));
      if (c.professionalId() != null) {
        slot.professionalId = c.professionalId();
      }
    }
    List<Integer> removals = req.remove() == null ? List.of() : new ArrayList<>(req.remove());
    removals.sort(Comparator.reverseOrder());
    for (int position : removals.stream().distinct().toList()) {
      Slot slot = slotAt(original, position);
      out.add(new Change("REMOVE", keyOf(slots, slot), null, null, null, null));
      slots.remove(slot);
    }
    for (Add a : adds(req)) {
      Long professional =
          a.professionalId() != null
              ? a.professionalId()
              : ctx.isProfessional() ? ctx.professionalId() : null;
      out.add(new Change("ADD", null, a.id(), a.quantity(), professional, a.unitPrice()));
    }
    return out;
  }

  private static Slot slotAt(List<Slot> original, int position) {
    if (position < 1 || position > original.size()) {
      throw new AssistantTools.ToolException("INVALID_LINE_POSITION");
    }
    return original.get(position - 1);
  }

  /** The n-th line of that service and professional, counting the lines as they are NOW. */
  private static LineKey keyOf(List<Slot> slots, Slot target) {
    int occurrence = 0;
    for (Slot s : slots) {
      if (Objects.equals(s.serviceId, target.serviceId)
          && Objects.equals(s.professionalId, target.professionalId)) {
        occurrence++;
      }
      if (s == target) {
        break;
      }
    }
    return new LineKey(target.serviceId, target.professionalId, occurrence);
  }

  // ---------------------------------------------------------------------------------------------
  // Applying changes

  private ServiceRecordDraftPayload assemble(
      AssistantContext ctx,
      Long clientId,
      String clientName,
      Base base,
      List<Change> changes,
      Catalog catalog) {
    List<W> working = new ArrayList<>();
    for (W w : base.lines()) {
      working.add(w.copy());
    }
    List<W> removed = new ArrayList<>();
    List<NotApplied> notApplied = new ArrayList<>();
    for (Change c : changes) {
      switch (c.op()) {
        case "ADD" -> applyAdd(ctx, c, working, catalog);
        case "REMOVE" -> {
          W target = find(working, c.key());
          if (target == null) {
            notApplied.add(new NotApplied("REMOVE", nameOf(c.key().serviceId(), catalog)));
          } else {
            working.remove(target);
            if (!target.isNew) {
              removed.add(target);
            }
          }
        }
        default -> {
          W target = find(working, c.key());
          if (target == null) {
            notApplied.add(new NotApplied("CHANGE", nameOf(c.key().serviceId(), catalog)));
          } else {
            applyChange(c, target, catalog);
          }
        }
      }
    }

    boolean money = ctx.isAdmin();
    List<Line> lines = linesOf(working, money);
    int position = 0;
    List<Line> numbered = new ArrayList<>();
    for (Line l : lines) {
      numbered.add(withPosition(l, ++position));
    }
    for (W w : removed) {
      numbered.add(withPosition(toLine(w, "REMOVED", money), 0));
    }
    BigDecimal total = null;
    if (money) {
      total = BigDecimal.ZERO;
      for (W w : working) {
        total = total.add(lineTotal(w.unit, w.quantity));
      }
    }
    return new ServiceRecordDraftPayload(
        clientId,
        clientName,
        base.recordId(),
        base.appointmentId(),
        base.appointmentTime(),
        numbered,
        List.copyOf(changes),
        List.copyOf(notApplied),
        total,
        base.fingerprint());
  }

  private void applyAdd(AssistantContext ctx, Change c, List<W> working, Catalog catalog) {
    ServiceResponse item = catalog.items().get(c.serviceId());
    if (item == null || !item.active()) {
      throw new AssistantTools.ToolException("SERVICE_NOT_FOUND");
    }
    int quantity = c.quantity() == null ? 1 : c.quantity();
    for (W w : working) {
      // Merge into the same item only when no other price was said: «another cut at 45.000» must
      // not reprice the cut that is already on the ficha.
      if (Objects.equals(w.serviceId, c.serviceId())
          && Objects.equals(w.professionalId, c.professionalId())
          && (c.unitPrice() == null || c.unitPrice().compareTo(w.unit) == 0)) {
        if (w.quantity + quantity > MAX_QUANTITY) {
          throw new AssistantTools.ToolException("INVALID_ARGUMENTS");
        }
        w.quantity += quantity;
        w.changed = !w.isNew;
        return;
      }
    }
    W w = new W();
    w.serviceId = item.id();
    w.name = item.name();
    w.quantity = quantity;
    w.unit = c.unitPrice() != null ? c.unitPrice() : nz(item.priceMinor());
    w.professionalId = c.professionalId();
    w.professionalName = professionalName(c.professionalId(), catalog);
    w.isNew = true;
    working.add(w);
  }

  private void applyChange(Change c, W w, Catalog catalog) {
    if (c.quantity() != null && c.quantity() != w.quantity) {
      w.quantity = c.quantity();
      w.changed = !w.isNew;
    }
    if (c.professionalId() != null && !Objects.equals(c.professionalId(), w.professionalId)) {
      w.professionalId = c.professionalId();
      w.professionalName = professionalName(c.professionalId(), catalog);
      w.changed = !w.isNew;
    }
    if (c.unitPrice() != null && c.unitPrice().compareTo(w.unit) != 0) {
      w.unit = c.unitPrice();
      w.changed = !w.isNew;
    }
  }

  private static W find(List<W> working, LineKey key) {
    int seen = 0;
    for (W w : working) {
      if (Objects.equals(w.serviceId, key.serviceId())
          && Objects.equals(w.professionalId, key.professionalId())
          && ++seen == key.occurrence()) {
        return w;
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------------------------
  // Where the changes apply: the ficha, the turno, or nothing yet

  private Base resolveBase(
      AssistantContext ctx, Request req, ClientResponse client, Catalog catalog) {
    long tenantId = ctx.tenantId();
    if (!req.newRecord()) {
      List<ServiceRecord> open = openRecords(ctx, client.id());
      if (req.recordId() != null) {
        ServiceRecord chosen =
            open.stream()
                .filter(r -> Objects.equals(r.getId(), req.recordId()))
                .findFirst()
                .orElseThrow(() -> new AssistantTools.ToolException("RECORD_NOT_FOUND"));
        return baseOfRecord(chosen, catalog);
      }
      List<ServiceRecord> today = open.stream().filter(this::createdToday).toList();
      if (today.size() == 1) {
        return baseOfRecord(today.get(0), catalog);
      }
      if (today.size() > 1) {
        throw new AssistantTools.ToolException(
            "MULTIPLE_RECORDS", Map.of("records", summaries(today, catalog)));
      }
      if (!open.isEmpty()) {
        throw new AssistantTools.ToolException(
            "STALE_RECORD", Map.of("records", summaries(open, catalog)));
      }
    }
    return resolveNew(ctx, req, client, catalog);
  }

  /** A ficha to create: linked to the turno of today when there is one, loose for the admin. */
  private Base resolveNew(
      AssistantContext ctx, Request req, ClientResponse client, Catalog catalog) {
    AppointmentResponse turno;
    if (req.appointmentId() != null) {
      turno = appointmentService.get(ctx.tenantId(), req.appointmentId());
      if (turno.clientId() == null || turno.clientId() != client.id()) {
        throw new AssistantTools.ToolException("APPOINTMENT_NOT_FOUND");
      }
      if (ctx.isProfessional() && turno.professionalId() != ownId(ctx)) {
        throw new AssistantTools.ToolException("APPOINTMENT_NOT_OWNED_BY_PROFESSIONAL");
      }
      if (!LINKABLE.contains(turno.status())) {
        throw new AssistantTools.ToolException("APPOINTMENT_NOT_ACTIVE");
      }
      if (turno.serviceRecordId() != null) {
        throw new AssistantTools.ToolException("APPOINTMENT_ALREADY_HAS_SERVICE_RECORD");
      }
    } else {
      List<AppointmentResponse> candidates =
          appointmentsToday(ctx.tenantId(), client.id()).stream()
              .filter(a -> LINKABLE.contains(a.status()) && a.serviceRecordId() == null)
              .filter(a -> !ctx.isProfessional() || a.professionalId() == ownId(ctx))
              .toList();
      if (candidates.isEmpty()) {
        if (ctx.isProfessional()) {
          throw new AssistantTools.ToolException("NO_APPOINTMENT_TODAY");
        }
        return new Base(null, null, null, List.of(), null);
      }
      if (candidates.size() > 1) {
        List<Map<String, Object>> options = new ArrayList<>();
        for (AppointmentResponse a : candidates) {
          Map<String, Object> o = new LinkedHashMap<>();
          o.put("appointmentId", a.id());
          o.put("start", startTime(a));
          o.put("serviceName", a.serviceName());
          options.add(o);
        }
        throw new AssistantTools.ToolException(
            "MULTIPLE_APPOINTMENTS", Map.of("appointments", options));
      }
      turno = candidates.get(0);
    }
    return baseOfAppointment(turno, catalog);
  }

  /** The state a stored draft's changes apply to (re-read: the world may have moved on). */
  private Base baseOf(
      AssistantContext ctx, Long recordId, Long appointmentId, Long clientId, Catalog catalog) {
    if (recordId != null) {
      ServiceRecord record =
          recordRepository
              .findByIdAndTenant_Id(recordId, ctx.tenantId())
              .orElseThrow(() -> new AssistantTools.ToolException("SERVICE_RECORD_NOT_FOUND"));
      if (record.getStatus() != ServiceRecordStatus.OPEN) {
        throw new AssistantTools.ToolException("SERVICE_RECORD_NOT_OPEN");
      }
      return baseOfRecord(record, catalog);
    }
    if (appointmentId != null) {
      AppointmentResponse turno = appointmentService.get(ctx.tenantId(), appointmentId);
      // The card lives 24 h: the turno may have moved on since it was proposed.
      if (turno.clientId() == null || !turno.clientId().equals(clientId)) {
        throw new AssistantTools.ToolException("APPOINTMENT_NOT_FOUND");
      }
      if (ctx.isProfessional() && turno.professionalId() != ownId(ctx)) {
        throw new AssistantTools.ToolException("APPOINTMENT_NOT_OWNED_BY_PROFESSIONAL");
      }
      if (!LINKABLE.contains(turno.status())) {
        throw new AssistantTools.ToolException("APPOINTMENT_NOT_ACTIVE");
      }
      if (turno.serviceRecordId() != null) {
        throw new AssistantTools.ToolException("APPOINTMENT_ALREADY_HAS_SERVICE_RECORD");
      }
      return baseOfAppointment(turno, catalog);
    }
    return new Base(null, null, null, List.of(), null);
  }

  private Base baseOfRecord(ServiceRecord record, Catalog catalog) {
    List<ServiceRecordLine> sorted =
        record.getLines().stream()
            .sorted(
                Comparator.comparing(
                    ServiceRecordLine::getId, Comparator.nullsLast(Comparator.naturalOrder())))
            .toList();
    List<W> lines = new ArrayList<>();
    StringBuilder print = new StringBuilder().append(record.getId());
    for (ServiceRecordLine l : sorted) {
      ServiceResponse s =
          l.getSalonService() == null ? null : catalog.items().get(l.getSalonService().getId());
      W w = new W();
      w.serviceId = l.getSalonService() == null ? null : l.getSalonService().getId();
      w.name =
          l.getDescription() != null && !l.getDescription().isBlank()
              ? l.getDescription()
              : s != null ? s.name() : "—";
      w.quantity = l.getQuantity() == null ? 1 : l.getQuantity();
      // A ficha line stores 0 when nobody priced it: that means «the catalog's price».
      w.unit =
          l.getUnitPrice() != null && l.getUnitPrice().signum() > 0
              ? l.getUnitPrice()
              : s == null ? BigDecimal.ZERO : nz(s.priceMinor());
      if (l.getProfessional() != null) {
        w.professionalId = l.getProfessional().getId();
        w.professionalName = l.getProfessional().getDisplayName();
      }
      lines.add(w);
      print
          .append('|')
          .append(w.serviceId)
          .append(',')
          .append(w.professionalId)
          .append(',')
          .append(w.quantity)
          .append(',')
          .append(w.unit.stripTrailingZeros().toPlainString());
    }
    return new Base(record.getId(), null, null, lines, sha256(print.toString()));
  }

  private Base baseOfAppointment(AppointmentResponse turno, Catalog catalog) {
    ServiceResponse s = catalog.items().get(turno.serviceId());
    W w = new W();
    w.serviceId = turno.serviceId();
    w.name = s != null ? s.name() : turno.serviceName();
    w.quantity = 1;
    w.unit = s == null ? BigDecimal.ZERO : nz(s.priceMinor());
    w.professionalId = turno.professionalId();
    w.professionalName = turno.professionalName();
    return new Base(null, turno.id(), startTime(turno), List.of(w), null);
  }

  /** Open fichas of the client this role may touch: a professional only gets today's. */
  private List<ServiceRecord> openRecords(AssistantContext ctx, long clientId) {
    return recordRepository
        .findByTenantAndClientAndStatusWithLines(ctx.tenantId(), clientId, ServiceRecordStatus.OPEN)
        .stream()
        .filter(r -> !ctx.isProfessional() || createdToday(r))
        .sorted(Comparator.comparing(ServiceRecord::getCreatedAt))
        .toList();
  }

  private boolean createdToday(ServiceRecord r) {
    ZoneId zone = timeProperties.zoneId();
    return r.getCreatedAt() != null
        && r.getCreatedAt().atZone(zone).toLocalDate().equals(LocalDate.now(zone));
  }

  private List<AppointmentResponse> appointmentsToday(long tenantId, long clientId) {
    ZoneId zone = timeProperties.zoneId();
    Instant from = LocalDate.now(zone).atStartOfDay(zone).toInstant();
    return appointmentService.list(tenantId, from, from.plusSeconds(86_400), null, clientId);
  }

  private String startTime(AppointmentResponse a) {
    return HH_MM.format(Instant.parse(a.startAt()).atZone(timeProperties.zoneId()));
  }

  private static long ownId(AssistantContext ctx) {
    return ctx.professionalId() == null ? -1L : ctx.professionalId();
  }

  private List<Map<String, Object>> summaries(List<ServiceRecord> records, Catalog catalog) {
    ZoneId zone = timeProperties.zoneId();
    List<Map<String, Object>> out = new ArrayList<>();
    for (ServiceRecord r : records) {
      Map<String, Object> m = new LinkedHashMap<>();
      m.put("recordId", r.getId());
      m.put("date", r.getCreatedAt().atZone(zone).toLocalDate().toString());
      m.put("services", baseOfRecord(r, catalog).lines().stream().map(w -> w.name).toList());
      out.add(m);
    }
    return out;
  }

  // ---------------------------------------------------------------------------------------------
  // Reading (ver_ficha_abierta)

  /** What the model reads about the client's open fichas and today's turnos, by role. */
  @Transactional(readOnly = true)
  public Map<String, Object> view(
      AssistantContext ctx, long clientId, Optional<ServiceRecordDraftPayload> pending) {
    ClientResponse client = clientService.getById(ctx.tenantId(), clientId);
    Catalog catalog = catalog(ctx.tenantId());
    boolean money = ctx.isAdmin();
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("clientName", client.fullName());

    ServiceRecordDraftPayload samePending =
        pending.filter(p -> Objects.equals(p.clientId(), client.id())).orElse(null);
    List<Map<String, Object>> records = new ArrayList<>();
    if (samePending != null) {
      // The list on the card is the one the person counts positions on.
      out.put("pending", true);
      Map<String, Object> m = new LinkedHashMap<>();
      m.put("recordId", samePending.serviceRecordId());
      m.put("appointmentId", samePending.appointmentId());
      m.put(
          "lines",
          samePending.lines().stream()
              .filter(l -> !"REMOVED".equals(l.mark()))
              .map(
                  l ->
                      lineView(
                          l.position(),
                          l.name(),
                          l.quantity(),
                          l.professionalName(),
                          l.unitPrice()))
              .toList());
      if (money && samePending.total() != null) {
        m.put("total", AssistantMoney.gs(samePending.total()));
      }
      records.add(m);
    } else {
      ZoneId zone = timeProperties.zoneId();
      for (ServiceRecord r : openRecords(ctx, client.id())) {
        Base base = baseOfRecord(r, catalog);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("recordId", r.getId());
        m.put("date", r.getCreatedAt().atZone(zone).toLocalDate().toString());
        List<Map<String, Object>> lines = new ArrayList<>();
        BigDecimal total = BigDecimal.ZERO;
        int position = 0;
        for (W w : base.lines()) {
          lines.add(
              lineView(++position, w.name, w.quantity, w.professionalName, money ? w.unit : null));
          total = total.add(lineTotal(w.unit, w.quantity));
        }
        m.put("lines", lines);
        if (money) {
          m.put("total", AssistantMoney.gs(total));
        }
        records.add(m);
      }
    }
    out.put("records", records);

    List<Map<String, Object>> turnos = new ArrayList<>();
    for (AppointmentResponse a : appointmentsToday(ctx.tenantId(), client.id())) {
      if (!LINKABLE.contains(a.status())) {
        continue;
      }
      Map<String, Object> m = new LinkedHashMap<>();
      m.put("appointmentId", a.id());
      m.put("start", startTime(a));
      m.put("serviceName", a.serviceName());
      m.put("professionalName", a.professionalName());
      m.put("hasRecord", a.serviceRecordId() != null);
      if (ctx.isProfessional()) {
        m.put("yours", a.professionalId() == ownId(ctx));
      }
      turnos.add(m);
    }
    out.put("appointmentsToday", turnos);
    return out;
  }

  private static Map<String, Object> lineView(
      int position, String name, int quantity, String professional, BigDecimal unit) {
    Map<String, Object> l = new LinkedHashMap<>();
    l.put("position", position);
    l.put("name", name);
    l.put("quantity", quantity);
    l.put("professionalName", professional);
    if (unit != null) {
      l.put("price", AssistantMoney.gs(unit));
    }
    return l;
  }

  // ---------------------------------------------------------------------------------------------
  // Saving

  /**
   * «Guardar ficha»: the services of the regular road, per role. Returns the id of the ficha. The
   * caller has already rebased the draft on the ficha as it is now.
   */
  public long commit(FemmeUserPrincipal principal, ServiceRecordDraftPayload fresh) {
    long tenantId = principal.getTenantId();
    boolean admin = principal.isAdmin();
    List<ServiceRecordLineRequest> lines = new ArrayList<>();
    for (Line l : fresh.lines()) {
      if ("REMOVED".equals(l.mark())) {
        continue;
      }
      // The prices a ficha line carries are the admin's; a professional's request has none and the
      // service she uses keeps the saved price (or takes the catalog's for a new line).
      BigDecimal price =
          admin && l.unitPrice() != null && l.unitPrice().signum() > 0 ? l.unitPrice() : null;
      lines.add(
          new ServiceRecordLineRequest(l.serviceId(), l.professionalId(), l.quantity(), price));
    }
    Long recordId = fresh.serviceRecordId();
    if (recordId != null) {
      saveLines(principal, recordId, fresh.clientId(), lines, true);
      return recordId;
    }
    if (fresh.appointmentId() != null) {
      long id =
          appointmentRecordService.createFromAppointment(tenantId, fresh.appointmentId()).id();
      saveLines(principal, id, fresh.clientId(), lines, false);
      return id;
    }
    if (!admin) {
      throw new AssistantTools.ToolException("NO_APPOINTMENT_TODAY");
    }
    return recordService
        .createServiceRecord(tenantId, new ServiceRecordRequest(fresh.clientId(), lines, List.of()))
        .id();
  }

  private void saveLines(
      FemmeUserPrincipal principal,
      long recordId,
      Long clientId,
      List<ServiceRecordLineRequest> lines,
      boolean keepTips) {
    long tenantId = principal.getTenantId();
    if (!principal.isAdmin()) {
      recordService.updateServicesAsProfessional(
          tenantId,
          recordId,
          new ServiceRecordRequest(clientId, lines, null),
          principal.getProfessionalId());
      return;
    }
    List<ServiceRecordTipRequest> tips = List.of();
    if (keepTips) {
      // A full replace would drop every tip: carry over the ones whose professional still has a
      // line.
      Set<Long> onLines = new java.util.HashSet<>();
      lines.forEach(l -> onLines.add(l.professionalId()));
      List<ServiceRecordTipResponse> current =
          recordService.getServiceRecord(tenantId, recordId).tips();
      tips =
          current == null
              ? List.of()
              : current.stream()
                  .filter(t -> onLines.contains(t.professionalId()))
                  .map(t -> new ServiceRecordTipRequest(t.professionalId(), t.amount()))
                  .toList();
    }
    recordService.updateServiceRecord(
        tenantId, recordId, new ServiceRecordRequest(clientId, lines, tips));
  }

  // ---------------------------------------------------------------------------------------------
  // Helpers

  private Catalog catalog(long tenantId) {
    Map<Long, ServiceResponse> items = new LinkedHashMap<>();
    catalogService
        .listServices(tenantId, Optional.empty(), null, null)
        .forEach(s -> items.put(s.id(), s));
    Map<Long, ProfessionalOptionResponse> pros = new LinkedHashMap<>();
    professionalDirectoryService.listOptions(tenantId).forEach(p -> pros.put(p.id(), p));
    return new Catalog(items, pros);
  }

  private static String nameOf(Long serviceId, Catalog catalog) {
    ServiceResponse s = serviceId == null ? null : catalog.items().get(serviceId);
    return s == null ? "—" : s.name();
  }

  private static String professionalName(Long id, Catalog catalog) {
    ProfessionalOptionResponse p = id == null ? null : catalog.pros().get(id);
    return p == null ? null : p.displayName();
  }

  private static BigDecimal nz(BigDecimal v) {
    return v == null ? BigDecimal.ZERO : v;
  }

  private static BigDecimal lineTotal(BigDecimal unit, int quantity) {
    return nz(unit).multiply(BigDecimal.valueOf(quantity)).setScale(2, RoundingMode.HALF_UP);
  }

  /** Lines for the card: marks against the saved ficha; amounts only when {@code money}. */
  private static List<Line> linesOf(List<W> working, boolean money) {
    List<Line> out = new ArrayList<>();
    for (W w : working) {
      out.add(toLine(w, w.isNew ? "NEW" : w.changed ? "CHANGED" : "KEPT", money));
    }
    return out;
  }

  private static Line toLine(W w, String mark, boolean money) {
    return new Line(
        0,
        w.serviceId,
        w.name,
        w.quantity,
        money ? w.unit : null,
        money ? lineTotal(w.unit, w.quantity) : null,
        w.professionalId,
        w.professionalName,
        mark);
  }

  private static Line withPosition(Line l, int position) {
    return new Line(
        position,
        l.serviceId(),
        l.name(),
        l.quantity(),
        l.unitPrice(),
        l.lineTotal(),
        l.professionalId(),
        l.professionalName(),
        l.mark());
  }

  /** What a draft changes, as one hash: if it differs, the person must look again. */
  public static String fingerprint(ServiceRecordDraftPayload p) {
    StringBuilder sb =
        new StringBuilder().append(p.serviceRecordId()).append('/').append(p.appointmentId());
    for (Line l : p.lines()) {
      sb.append('|')
          .append(l.position())
          .append(',')
          .append(l.serviceId())
          .append(',')
          .append(l.quantity())
          .append(',')
          .append(l.professionalId())
          .append(',')
          .append(l.mark())
          .append(',')
          .append(l.unitPrice() == null ? "" : l.unitPrice().stripTrailingZeros().toPlainString());
    }
    return sha256(sb.toString());
  }

  private static String sha256(String text) {
    try {
      byte[] digest =
          MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8));
      return HexFormat.of().formatHex(digest);
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException(e);
    }
  }
}
