package com.cursorpoc.backend.commission;

import com.cursorpoc.backend.domain.AguinaldoMovement;
import com.cursorpoc.backend.domain.CommissionSettlement;
import com.cursorpoc.backend.domain.enums.AguinaldoMovementKind;
import com.cursorpoc.backend.domain.enums.CommissionSettlementStatus;
import com.cursorpoc.backend.repository.AguinaldoMovementRepository;
import com.cursorpoc.backend.repository.CommissionEntryRepository;
import com.cursorpoc.backend.repository.CommissionSettlementRepository;
import com.cursorpoc.backend.web.dto.CommissionDtos.AguinaldoAdjustmentRequest;
import com.cursorpoc.backend.web.dto.CommissionDtos.AguinaldoBalance;
import com.cursorpoc.backend.web.dto.CommissionDtos.AguinaldoBulkPaymentRequest;
import com.cursorpoc.backend.web.dto.CommissionDtos.AguinaldoDetail;
import com.cursorpoc.backend.web.dto.CommissionDtos.AguinaldoMovementView;
import com.cursorpoc.backend.web.dto.CommissionDtos.AguinaldoPaymentRequest;
import com.cursorpoc.backend.web.dto.CommissionDtos.AguinaldoSummary;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * HU-COM-14: fondo de aguinaldo de cada profesional. Lo retenido entra solo cuando la liquidación
 * se aprueba (suma de {@code retention_amount} de sus movimientos); los pagos y ajustes manuales
 * viven en {@code aguinaldo_movements}. Saldo = retenido + pagos (negativos) + ajustes.
 */
@Service
public class AguinaldoService {

  static final Set<String> PAYMENT_METHODS = Set.of("CASH", "TRANSFER", "OTHER");

  private final CommissionSettlementRepository settlementRepository;
  private final CommissionEntryRepository entryRepository;
  private final AguinaldoMovementRepository movementRepository;
  private final CommissionConfigService configService;
  private final CommissionLedger ledger;

  public AguinaldoService(
      CommissionSettlementRepository settlementRepository,
      CommissionEntryRepository entryRepository,
      AguinaldoMovementRepository movementRepository,
      CommissionConfigService configService,
      CommissionLedger ledger) {
    this.settlementRepository = settlementRepository;
    this.entryRepository = entryRepository;
    this.movementRepository = movementRepository;
    this.configService = configService;
    this.ledger = ledger;
  }

  public boolean enabled(long tenantId) {
    return ledger.snapshot(tenantId).aguinaldoEnabledAt(Instant.now());
  }

  /** Retention accrued from approved / paid settlements, per professional (and per settlement). */
  private record Accrual(CommissionSettlement settlement, BigDecimal amount) {}

  private List<Accrual> accruals(long tenantId, Long professionalId) {
    Map<Long, CommissionSettlement> closed = new HashMap<>();
    for (CommissionSettlement s :
        settlementRepository.findByTenantIdOrderByPeriodFromDescIdDesc(tenantId)) {
      if ((professionalId == null || s.getProfessionalId().equals(professionalId))
          && (s.getStatus() == CommissionSettlementStatus.APPROVED
              || s.getStatus() == CommissionSettlementStatus.PAID)) {
        closed.put(s.getId(), s);
      }
    }
    List<Accrual> result = new ArrayList<>();
    for (Object[] row : entryRepository.retentionBySettlement(tenantId, professionalId)) {
      CommissionSettlement s = closed.get((Long) row[0]);
      BigDecimal amount = (BigDecimal) row[2];
      if (s != null && amount.signum() != 0) {
        result.add(new Accrual(s, amount));
      }
    }
    return result;
  }

  @Transactional(readOnly = true)
  public BigDecimal balanceOf(long tenantId, long professionalId) {
    BigDecimal retained =
        accruals(tenantId, professionalId).stream()
            .map(Accrual::amount)
            .reduce(BigDecimal.ZERO, BigDecimal::add);
    return retained.add(movementRepository.sumByProfessional(tenantId, professionalId));
  }

  @Transactional(readOnly = true)
  public AguinaldoSummary summary(long tenantId) {
    Map<Long, BigDecimal> retained = new HashMap<>();
    for (Accrual a : accruals(tenantId, null)) {
      retained.merge(a.settlement().getProfessionalId(), a.amount(), BigDecimal::add);
    }
    Map<Long, BigDecimal> paid = new HashMap<>();
    Map<Long, BigDecimal> manual = new HashMap<>();
    Map<Long, LocalDate> lastPayment = new HashMap<>();
    Set<Long> ids = new LinkedHashSet<>(retained.keySet());
    for (AguinaldoMovement m :
        movementRepository.findByTenantIdOrderByOccurredOnAscIdAsc(tenantId)) {
      ids.add(m.getProfessionalId());
      if (m.getKind() == AguinaldoMovementKind.PAYMENT) {
        paid.merge(m.getProfessionalId(), m.getAmount().negate(), BigDecimal::add);
        lastPayment.put(m.getProfessionalId(), m.getOccurredOn());
      }
      manual.merge(m.getProfessionalId(), m.getAmount(), BigDecimal::add);
    }
    Map<Long, String> names = configService.professionalNames(tenantId);
    Set<Long> activeIds = new LinkedHashSet<>();
    configService.activeProfessionalIds(tenantId).forEach(activeIds::add);
    List<AguinaldoBalance> balances = new ArrayList<>();
    BigDecimal total = BigDecimal.ZERO;
    for (Long id : ids) {
      BigDecimal r = retained.getOrDefault(id, BigDecimal.ZERO);
      BigDecimal balance = r.add(manual.getOrDefault(id, BigDecimal.ZERO));
      total = total.add(balance);
      balances.add(
          new AguinaldoBalance(
              id,
              names.get(id),
              activeIds.contains(id),
              r,
              paid.getOrDefault(id, BigDecimal.ZERO),
              balance,
              lastPayment.get(id)));
    }
    balances.sort(
        Comparator.comparing(b -> b.professionalName() == null ? "" : b.professionalName()));
    return new AguinaldoSummary(enabled(tenantId), total, balances);
  }

  @Transactional(readOnly = true)
  public AguinaldoDetail detail(long tenantId, long professionalId) {
    String name = requireProfessional(tenantId, professionalId);
    List<Row> rows = new ArrayList<>();
    for (Accrual a : accruals(tenantId, professionalId)) {
      CommissionSettlement s = a.settlement();
      Instant at = s.getApprovedAt() != null ? s.getApprovedAt() : s.getCreatedAt();
      rows.add(
          new Row(
              0,
              LocalDate.ofInstant(at, configService.zone()),
              s.getId(),
              new AguinaldoMovementView(
                  "ACCRUAL",
                  LocalDate.ofInstant(at, configService.zone()),
                  null,
                  a.amount(),
                  null,
                  s.getId(),
                  null,
                  null,
                  false,
                  s.getPeriodFrom() + " – " + s.getPeriodTo())));
    }
    for (AguinaldoMovement m :
        movementRepository.findByTenantIdAndProfessionalIdOrderByOccurredOnAscIdAsc(
            tenantId, professionalId)) {
      rows.add(
          new Row(
              1,
              m.getOccurredOn(),
              m.getId(),
              new AguinaldoMovementView(
                  m.getKind().name(),
                  m.getOccurredOn(),
                  null,
                  m.getAmount(),
                  null,
                  null,
                  m.getId(),
                  m.getPaymentMethod(),
                  m.isClosesFund(),
                  m.getNote())));
    }
    rows.sort(Comparator.comparing(Row::date).thenComparingInt(Row::order).thenComparing(Row::id));
    BigDecimal running = BigDecimal.ZERO;
    List<AguinaldoMovementView> view = new ArrayList<>();
    for (Row r : rows) {
      running = running.add(r.view().amount());
      AguinaldoMovementView v = r.view();
      view.add(
          new AguinaldoMovementView(
              v.kind(),
              v.date(),
              v.concept(),
              v.amount(),
              running,
              v.settlementId(),
              v.movementId(),
              v.paymentMethod(),
              v.closesFund(),
              v.note()));
    }
    java.util.Collections.reverse(view); // newest first
    return new AguinaldoDetail(professionalId, name, running, view);
  }

  private record Row(int order, LocalDate date, Long id, AguinaldoMovementView view) {}

  @Transactional
  public AguinaldoMovement pay(long tenantId, String actorEmail, AguinaldoPaymentRequest request) {
    if (request == null || request.professionalId() == null) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "PROFESSIONAL_NOT_FOUND");
    }
    requireProfessional(tenantId, request.professionalId());
    String method = method(request.paymentMethod());
    BigDecimal balance = balanceOf(tenantId, request.professionalId());
    if (balance.signum() <= 0) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "AGUINALDO_NOTHING_TO_PAY");
    }
    BigDecimal amount =
        request.closesFund() || request.amount() == null ? balance : request.amount();
    amount = amount.setScale(CommissionCalculator.CURRENCY_SCALE, RoundingMode.HALF_UP);
    if (amount.signum() <= 0) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "AGUINALDO_AMOUNT_INVALID");
    }
    if (amount.compareTo(balance) > 0) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "AGUINALDO_AMOUNT_EXCEEDS_BALANCE");
    }
    return save(
        tenantId,
        request.professionalId(),
        AguinaldoMovementKind.PAYMENT,
        amount.negate(),
        request.paidOn(),
        method,
        request.closesFund(),
        request.note(),
        actorEmail);
  }

  /** Pays the whole balance to every professional that has one. */
  @Transactional
  public int payAll(long tenantId, String actorEmail, AguinaldoBulkPaymentRequest request) {
    String method = method(request == null ? null : request.paymentMethod());
    int count = 0;
    for (AguinaldoBalance b : summary(tenantId).balances()) {
      if (b.balance().signum() > 0) {
        save(
            tenantId,
            b.professionalId(),
            AguinaldoMovementKind.PAYMENT,
            b.balance().negate(),
            request.paidOn(),
            method,
            false,
            request.note(),
            actorEmail);
        count++;
      }
    }
    if (count == 0) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "AGUINALDO_NOTHING_TO_PAY");
    }
    return count;
  }

  @Transactional
  public AguinaldoMovement adjust(
      long tenantId, String actorEmail, AguinaldoAdjustmentRequest request) {
    if (request == null || request.professionalId() == null) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "PROFESSIONAL_NOT_FOUND");
    }
    requireProfessional(tenantId, request.professionalId());
    if (request.amount() == null || request.amount().signum() == 0) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "AGUINALDO_AMOUNT_INVALID");
    }
    if (request.reason() == null || request.reason().isBlank()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "AGUINALDO_REASON_REQUIRED");
    }
    BigDecimal amount =
        request.amount().setScale(CommissionCalculator.CURRENCY_SCALE, RoundingMode.HALF_UP);
    if (balanceOf(tenantId, request.professionalId()).add(amount).signum() < 0) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "AGUINALDO_BALANCE_NEGATIVE");
    }
    return save(
        tenantId,
        request.professionalId(),
        AguinaldoMovementKind.ADJUSTMENT,
        amount,
        null,
        null,
        false,
        request.reason().trim(),
        actorEmail);
  }

  private AguinaldoMovement save(
      long tenantId,
      long professionalId,
      AguinaldoMovementKind kind,
      BigDecimal amount,
      LocalDate on,
      String method,
      boolean closesFund,
      String note,
      String actorEmail) {
    AguinaldoMovement m = new AguinaldoMovement();
    m.setTenantId(tenantId);
    m.setProfessionalId(professionalId);
    m.setKind(kind);
    m.setAmount(amount);
    m.setOccurredOn(on != null ? on : LocalDate.now(configService.zone()));
    m.setPaymentMethod(method);
    m.setClosesFund(closesFund);
    m.setNote(note == null || note.isBlank() ? null : note.trim());
    m.setCreatedAt(Instant.now());
    m.setCreatedByEmail(actorEmail);
    return movementRepository.save(m);
  }

  private static String method(String raw) {
    String method = raw == null ? null : raw.trim();
    if (method == null || !PAYMENT_METHODS.contains(method)) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "AGUINALDO_PAYMENT_METHOD_INVALID");
    }
    return method;
  }

  private String requireProfessional(long tenantId, long professionalId) {
    String name = configService.professionalNames(tenantId).get(professionalId);
    if (name == null) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "PROFESSIONAL_NOT_FOUND");
    }
    return name;
  }
}
