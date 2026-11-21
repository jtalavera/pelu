package com.cursorpoc.backend.assistant;

import com.cursorpoc.backend.assistant.AssistantDraftPayloads.InvoiceDraftPayload;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.service.InvoiceEmissionService;
import com.cursorpoc.backend.web.dto.InvoiceResponse;
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
  private final InvoiceEmissionService emissionService;
  private final ObjectMapper objectMapper;
  private final TransactionTemplate tx;

  public AssistantDraftService(
      AssistantDraftRepository drafts,
      AssistantInvoiceDrafts invoiceDrafts,
      InvoiceEmissionService emissionService,
      ObjectMapper objectMapper,
      PlatformTransactionManager transactionManager) {
    this.drafts = drafts;
    this.invoiceDrafts = invoiceDrafts;
    this.emissionService = emissionService;
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
    List<String> superseded = supersedeActive(ctx.conversationId());
    Instant now = Instant.now();
    AssistantDraft draft =
        new AssistantDraft(
            ctx.tenantId(),
            ctx.userId(),
            ctx.conversationId(),
            AssistantDraftType.INVOICE,
            toJson(payload),
            AssistantInvoiceDrafts.fingerprint(payload),
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
  public record Completion(String paymentMethod, String cardBrand, String email) {}

  @Transactional
  public AssistantDraftDto complete(long tenantId, long userId, UUID id, Completion completion) {
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
              completion.email());
      d.setPayload(toJson(updated));
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
   * invoicing road already throws); a refused confirmation leaves the draft as it was.
   */
  public ConfirmResult confirm(FemmeUserPrincipal principal, UUID id) {
    if (!principal.isAdmin()) {
      // Today only invoices exist as drafts and /api/invoices is ADMIN-only for everyone.
      throw new AssistantDraftException(HttpStatus.FORBIDDEN, "FORBIDDEN");
    }
    long tenantId = principal.getTenantId();
    long userId = principal.getUserId();
    Outcome outcome = tx.execute(status -> confirmInTransaction(tenantId, userId, id));
    if (outcome instanceof Repriced r) {
      // Committed (the draft now carries the new prices): tell the person, who must look again.
      throw new AssistantDraftException(
          HttpStatus.CONFLICT, "ASSISTANT_PRICE_CHANGED", Map.of("draft", r.draft()));
    }
    return ((Confirmed) outcome).result();
  }

  private Outcome confirmInTransaction(long tenantId, long userId, UUID id) {
    AssistantDraft d = load(tenantId, userId, id);
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
