package com.cursorpoc.backend.assistant;

import com.cursorpoc.backend.assistant.AssistantDraftPayloads.AppointmentDraftPayload;
import com.cursorpoc.backend.assistant.AssistantDraftPayloads.InvoiceDraftPayload;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.service.AppointmentService;
import com.cursorpoc.backend.service.InvoiceEmissionService;
import com.cursorpoc.backend.web.dto.AppointmentResponse;
import com.cursorpoc.backend.web.dto.InvoiceResponse;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * The life of drafts: propose (replacing the previous one), complete from the card, discard, expire
 * after 24 h and CONFIRM — the only place where a draft becomes real data, always by a person's tap
 * on a button (an endpoint), never by a tool the model can call.
 *
 * <p>Confirming is atomic: the draft is claimed (DRAFT → CONFIRMING) in one statement, re-priced
 * against the catalog/record now, and the invoice is issued through the regular road in the SAME
 * transaction — if issuing fails everything rolls back and the draft is still DRAFT, with the error
 * shown on the card.
 */
@Service
public class AssistantDraftService {

  private static final Logger log = LoggerFactory.getLogger(AssistantDraftService.class);

  /** A draft not confirmed in this time expires. */
  static final Duration TTL = Duration.ofHours(24);

  private final AssistantDraftRepository drafts;
  private final AssistantInvoiceDrafts invoiceDrafts;
  private final AssistantAppointmentDrafts appointmentDrafts;
  private final InvoiceEmissionService emissionService;
  private final AppointmentService appointmentService;
  private final ObjectMapper objectMapper;
  private final TransactionTemplate tx;

  public AssistantDraftService(
      AssistantDraftRepository drafts,
      AssistantInvoiceDrafts invoiceDrafts,
      AssistantAppointmentDrafts appointmentDrafts,
      InvoiceEmissionService emissionService,
      AppointmentService appointmentService,
      ObjectMapper objectMapper,
      PlatformTransactionManager transactionManager) {
    this.drafts = drafts;
    this.invoiceDrafts = invoiceDrafts;
    this.appointmentDrafts = appointmentDrafts;
    this.emissionService = emissionService;
    this.appointmentService = appointmentService;
    this.objectMapper = objectMapper;
    this.tx = new TransactionTemplate(transactionManager);
  }

  /** A new draft and the ids of the ones it replaced. */
  public record Created(AssistantDraftDto draft, List<String> supersededIds) {}

  /** What confirming produced. */
  public record ConfirmResult(
      String type,
      Long invoiceId,
      String invoiceNumberFormatted,
      String sifenSubmissionStatus,
      Long appointmentId,
      String startAt,
      Long professionalId,
      AssistantDraftDto draft) {}

  // ---------------------------------------------------------------------------------------------
  // Propose / list

  /** Only one active draft per conversation: a new proposal supersedes the previous one. */
  @Transactional
  public Created createInvoiceDraft(AssistantContext ctx, InvoiceDraftPayload payload) {
    return create(
        ctx, AssistantDraftType.INVOICE, payload, AssistantInvoiceDrafts.fingerprint(payload));
  }

  @Transactional
  public Created createAppointmentDraft(AssistantContext ctx, AppointmentDraftPayload payload) {
    return create(
        ctx,
        AssistantDraftType.APPOINTMENT,
        payload,
        AssistantAppointmentDrafts.fingerprint(payload));
  }

  private Created create(
      AssistantContext ctx, AssistantDraftType type, Object payload, String fingerprint) {
    List<String> superseded = supersedeActive(ctx.conversationId());
    Instant now = Instant.now();
    AssistantDraft draft =
        new AssistantDraft(
            ctx.tenantId(),
            ctx.userId(),
            ctx.conversationId(),
            type,
            toJson(payload),
            fingerprint,
            now,
            now.plus(TTL));
    drafts.save(draft);
    return new Created(toDto(draft), superseded);
  }

  @Transactional(readOnly = true)
  public List<AssistantDraftDto> forConversation(long conversationId) {
    return drafts.findByConversationIdOrderByCreatedAtAsc(conversationId).stream()
        .map(this::toDto)
        .toList();
  }

  // ---------------------------------------------------------------------------------------------
  // Discard / complete

  @Transactional
  public AssistantDraftDto discard(long tenantId, long userId, UUID id) {
    AssistantDraft d = load(tenantId, userId, id);
    if (effective(d) != AssistantDraftStatus.DRAFT) {
      throw new AssistantDraftException(HttpStatus.CONFLICT, notActiveCode(d));
    }
    d.setStatus(AssistantDraftStatus.DISCARDED);
    d.setUpdatedAt(Instant.now());
    drafts.save(d);
    return toDto(d);
  }

  /** «Descartá el borrador» said in the chat: the conversation's active draft. */
  @Transactional
  public List<AssistantDraftDto> discardActive(long tenantId, long userId, Long conversationId) {
    List<AssistantDraftDto> out = new ArrayList<>();
    if (conversationId == null) {
      return out;
    }
    for (AssistantDraft d :
        drafts.findByConversationIdAndStatus(conversationId, AssistantDraftStatus.DRAFT)) {
      if (d.getTenantId() == tenantId && d.getUserId() == userId) {
        d.setStatus(AssistantDraftStatus.DISCARDED);
        d.setUpdatedAt(Instant.now());
        drafts.save(d);
        out.add(toDto(d));
      }
    }
    return out;
  }

  /** What the card sends to complete missing data. */
  public record Completion(
      String paymentMethod,
      String cardBrand,
      String email,
      /** APPOINTMENT: another slot (ISO instant) and, optionally, another professional. */
      String startAt,
      Long professionalId,
      /** INVOICE: unit prices typed on the card, by line position. */
      List<LinePrice> linePrices) {}

  /** A unit price the person typed for the line at {@code index} (whole guaraníes). */
  public record LinePrice(Integer index, BigDecimal unitPrice) {}

  /**
   * @param ownProfessionalId set for a PROFESSIONAL: she can only move an appointment onto herself
   */
  @Transactional
  public AssistantDraftDto complete(
      long tenantId, long userId, Long ownProfessionalId, UUID id, Completion completion) {
    AssistantDraft d = load(tenantId, userId, id);
    if (effective(d) != AssistantDraftStatus.DRAFT) {
      throw new AssistantDraftException(HttpStatus.CONFLICT, notActiveCode(d));
    }
    if (d.getType() == AssistantDraftType.INVOICE) {
      InvoiceDraftPayload updated =
          invoiceDrafts.complete(
              fromJson(d, InvoiceDraftPayload.class),
              completion.paymentMethod(),
              completion.cardBrand(),
              completion.email(),
              completion.linePrices());
      d.setPayload(toJson(updated));
      // What the draft charges changed: the stored fingerprint must follow, or confirming would
      // mistake the person's own edit for «the price changed».
      d.setPayloadHash(AssistantInvoiceDrafts.fingerprint(updated));
    } else if (completion.startAt() != null) {
      AppointmentDraftPayload old = fromJson(d, AppointmentDraftPayload.class);
      Long professionalId =
          ownProfessionalId != null ? ownProfessionalId : completion.professionalId();
      try {
        AppointmentDraftPayload moved =
            appointmentDrafts.reschedule(
                tenantId, old, Instant.parse(completion.startAt()), professionalId, Instant.now());
        d.setPayload(toJson(moved));
        d.setPayloadHash(AssistantAppointmentDrafts.fingerprint(moved));
      } catch (AssistantTools.ToolException e) {
        throw refused(e, d);
      }
    }
    d.setUpdatedAt(Instant.now());
    drafts.save(d);
    return toDto(d);
  }

  // ---------------------------------------------------------------------------------------------
  // Confirm

  /** The outcome of the transactional part of confirming. */
  private sealed interface Outcome permits Confirmed, Repriced {}

  private record Confirmed(ConfirmResult result) implements Outcome {}

  private record Repriced(AssistantDraftDto draft) implements Outcome {}

  /**
   * Confirms a draft. Errors are {@link AssistantDraftException}s (or the codes the regular
   * invoicing / booking roads already throw); a refused confirmation leaves the draft as it was.
   */
  public ConfirmResult confirm(FemmeUserPrincipal principal, UUID id) {
    long tenantId = principal.getTenantId();
    Outcome outcome = tx.execute(status -> confirmInTransaction(principal, tenantId, id));
    if (outcome instanceof Repriced r) {
      // Committed (the draft now carries the new prices): tell the person, who must look again.
      throw new AssistantDraftException(
          HttpStatus.CONFLICT, "ASSISTANT_PRICE_CHANGED", Map.of("draft", r.draft()));
    }
    return ((Confirmed) outcome).result();
  }

  private Outcome confirmInTransaction(FemmeUserPrincipal principal, long tenantId, UUID id) {
    long userId = principal.getUserId();
    AssistantDraft d = load(tenantId, userId, id);
    // Invoices are administration's; an appointment is administration's or the professional's own.
    if (d.getType() == AssistantDraftType.INVOICE && !principal.isAdmin()) {
      throw new AssistantDraftException(HttpStatus.FORBIDDEN, "FORBIDDEN");
    }
    if (d.getType() == AssistantDraftType.APPOINTMENT) {
      requireMayBook(principal, fromJson(d, AppointmentDraftPayload.class));
    }
    switch (d.getStatus()) {
      case CONFIRMED -> throw alreadyConfirmed(d);
      case DRAFT -> {
        if (!d.getExpiresAt().isAfter(Instant.now())) {
          throw new AssistantDraftException(HttpStatus.CONFLICT, "ASSISTANT_DRAFT_EXPIRED");
        }
      }
      case EXPIRED ->
          throw new AssistantDraftException(HttpStatus.CONFLICT, "ASSISTANT_DRAFT_EXPIRED");
      default ->
          throw new AssistantDraftException(HttpStatus.CONFLICT, "ASSISTANT_DRAFT_NOT_ACTIVE");
    }
    return d.getType() == AssistantDraftType.INVOICE
        ? confirmInvoice(tenantId, userId, d)
        : confirmAppointment(principal, tenantId, userId, d);
  }

  private static void requireMayBook(FemmeUserPrincipal principal, AppointmentDraftPayload p) {
    if (principal.isAdmin()) {
      return;
    }
    if (!principal.isProfessional() || principal.getProfessionalId() == null) {
      throw new AssistantDraftException(HttpStatus.FORBIDDEN, "FORBIDDEN");
    }
    if (!principal.getProfessionalId().equals(p.professionalId())) {
      throw new AssistantDraftException(
          HttpStatus.FORBIDDEN, "APPOINTMENT_NOT_OWNED_BY_PROFESSIONAL");
    }
  }

  private Outcome confirmAppointment(
      FemmeUserPrincipal principal, long tenantId, long userId, AssistantDraft d) {
    AppointmentDraftPayload payload = fromJson(d, AppointmentDraftPayload.class);
    if (drafts.claim(d.getId(), tenantId, userId, Instant.now()) == 0) {
      AssistantDraft current = load(tenantId, userId, d.getId());
      throw current.getStatus() == AssistantDraftStatus.CONFIRMED
          ? alreadyConfirmed(current)
          : new AssistantDraftException(HttpStatus.CONFLICT, notActiveCode(current));
    }
    AssistantDraft claimed = load(tenantId, userId, d.getId());
    AppointmentResponse appointment;
    try {
      // Still bookable now? (inactive professional/service, slot taken meanwhile)
      appointmentDrafts.revalidate(tenantId, payload, Instant.now());
      appointment = appointmentService.create(tenantId, appointmentDrafts.toRequest(payload));
    } catch (AssistantTools.ToolException e) {
      throw refused(e, claimed);
    } catch (ResponseStatusException e) {
      if ("APPOINTMENT_OVERLAP".equals(e.getReason())) {
        // Lost the race between the check and the insert: same answer, with alternatives.
        throw refused(
            new AssistantTools.ToolException(
                "SLOT_TAKEN",
                Map.of(
                    "alternatives",
                    appointmentDrafts.alternatives(
                        tenantId,
                        java.time.LocalDate.parse(payload.date()),
                        payload.durationMinutes(),
                        payload.professionalId(),
                        Instant.now()))),
            claimed);
      }
      throw e;
    }
    claimed.setStatus(AssistantDraftStatus.CONFIRMED);
    claimed.setResult("APPOINTMENT", appointment.id());
    claimed.setUpdatedAt(Instant.now());
    drafts.save(claimed);
    log.info(
        "assistant draft confirmed tenantId={} type=APPOINTMENT appointmentId={}",
        tenantId,
        appointment.id());
    return new Confirmed(
        new ConfirmResult(
            "APPOINTMENT",
            null,
            null,
            null,
            appointment.id(),
            appointment.startAt(),
            appointment.professionalId(),
            toDto(claimed)));
  }

  /**
   * A refusal of a draft operation: {@code SLOT_TAKEN} becomes 409 {@code ASSISTANT_SLOT_TAKEN}
   * with the alternatives and the draft; any other tool code is a plain 409 with that code.
   */
  private AssistantDraftException refused(AssistantTools.ToolException e, AssistantDraft d) {
    if ("SLOT_TAKEN".equals(e.getMessage())) {
      Map<String, Object> extra = new LinkedHashMap<>(e.extra());
      extra.put("draft", toDto(d).withStatus("DRAFT"));
      return new AssistantDraftException(HttpStatus.CONFLICT, "ASSISTANT_SLOT_TAKEN", extra);
    }
    return new AssistantDraftException(HttpStatus.CONFLICT, e.getMessage());
  }

  private Outcome confirmInvoice(long tenantId, long userId, AssistantDraft d) {
    UUID id = d.getId();
    InvoiceDraftPayload payload = fromJson(d, InvoiceDraftPayload.class);
    List<String> missing = invoiceDrafts.missing(tenantId, payload);
    if (!missing.isEmpty()) {
      throw new AssistantDraftException(
          HttpStatus.BAD_REQUEST, "ASSISTANT_DRAFT_INCOMPLETE", Map.of("draft", toDto(d)));
    }
    // One statement takes it; a concurrent second tap waits here for the first one's row lock.
    if (drafts.claim(id, tenantId, userId, Instant.now()) == 0) {
      AssistantDraft current = load(tenantId, userId, id);
      throw current.getStatus() == AssistantDraftStatus.CONFIRMED
          ? alreadyConfirmed(current)
          : new AssistantDraftException(HttpStatus.CONFLICT, notActiveCode(current));
    }
    AssistantDraft claimed = load(tenantId, userId, id);

    InvoiceDraftPayload fresh;
    try {
      fresh = invoiceDrafts.reprice(tenantId, payload);
    } catch (AssistantTools.ToolException e) {
      throw new AssistantDraftException(HttpStatus.CONFLICT, e.getMessage());
    }
    String freshHash = AssistantInvoiceDrafts.fingerprint(fresh);
    if (!freshHash.equals(claimed.getPayloadHash())) {
      claimed.setPayload(toJson(fresh));
      claimed.setPayloadHash(freshHash);
      claimed.setStatus(AssistantDraftStatus.DRAFT);
      claimed.setUpdatedAt(Instant.now());
      drafts.save(claimed);
      return new Repriced(toDto(claimed));
    }

    InvoiceResponse invoice =
        emissionService.issue(tenantId, invoiceDrafts.toRequest(tenantId, fresh));
    claimed.setStatus(AssistantDraftStatus.CONFIRMED);
    claimed.setResult("INVOICE", invoice.id());
    claimed.setUpdatedAt(Instant.now());
    drafts.save(claimed);
    log.info(
        "assistant draft confirmed tenantId={} type=INVOICE invoiceId={}", tenantId, invoice.id());
    return new Confirmed(
        new ConfirmResult(
            "INVOICE",
            invoice.id(),
            invoice.invoiceNumberFormatted(),
            invoice.sifenSubmissionStatus(),
            null,
            null,
            null,
            toDto(claimed)));
  }

  /** The second tap of a double tap: 409 carrying the original result, nothing is issued twice. */
  private AssistantDraftException alreadyConfirmed(AssistantDraft d) {
    Map<String, Object> extra = new LinkedHashMap<>();
    extra.put("draft", toDto(d));
    extra.put("type", d.getResultType());
    extra.put("invoiceId", d.getResultId());
    return new AssistantDraftException(
        HttpStatus.CONFLICT, "ASSISTANT_DRAFT_ALREADY_CONFIRMED", extra);
  }

  // ---------------------------------------------------------------------------------------------
  // Expiry / helpers

  /** Marks the drafts nobody confirmed in 24 h. Run by {@link AssistantRetentionJob}. */
  @Transactional
  public int expireDue() {
    return drafts.expireDue(Instant.now());
  }

  private List<String> supersedeActive(Long conversationId) {
    List<String> ids = new ArrayList<>();
    if (conversationId == null) {
      return ids;
    }
    for (AssistantDraft old :
        drafts.findByConversationIdAndStatus(conversationId, AssistantDraftStatus.DRAFT)) {
      old.setStatus(AssistantDraftStatus.SUPERSEDED);
      old.setUpdatedAt(Instant.now());
      drafts.save(old);
      ids.add(old.getId().toString());
    }
    return ids;
  }

  private AssistantDraft load(long tenantId, long userId, UUID id) {
    return drafts
        .findByIdAndTenantIdAndUserId(id, tenantId, userId)
        .orElseThrow(
            () -> new AssistantDraftException(HttpStatus.NOT_FOUND, "ASSISTANT_DRAFT_NOT_FOUND"));
  }

  /** A DRAFT past its expiry reads as EXPIRED even before the job marks it. */
  private static AssistantDraftStatus effective(AssistantDraft d) {
    return d.getStatus() == AssistantDraftStatus.DRAFT && !d.getExpiresAt().isAfter(Instant.now())
        ? AssistantDraftStatus.EXPIRED
        : d.getStatus();
  }

  private static String notActiveCode(AssistantDraft d) {
    return effective(d) == AssistantDraftStatus.EXPIRED
        ? "ASSISTANT_DRAFT_EXPIRED"
        : "ASSISTANT_DRAFT_NOT_ACTIVE";
  }

  public AssistantDraftDto toDto(AssistantDraft d) {
    AssistantDraftStatus status = effective(d);
    List<String> missing = List.of();
    if (status == AssistantDraftStatus.DRAFT && d.getType() == AssistantDraftType.INVOICE) {
      missing = invoiceDrafts.missing(d.getTenantId(), fromJson(d, InvoiceDraftPayload.class));
    }
    JsonNode payload = objectMapper.readTree(d.getPayload());
    return new AssistantDraftDto(
        d.getId().toString(),
        d.getType().name(),
        status.name(),
        d.getCreatedAt().toString(),
        d.getExpiresAt().toString(),
        missing,
        payload,
        d.getResultType(),
        d.getResultId(),
        null);
  }

  private String toJson(Object payload) {
    return objectMapper.writeValueAsString(payload);
  }

  private <T> T fromJson(AssistantDraft d, Class<T> type) {
    return objectMapper.readValue(d.getPayload(), type);
  }
}
