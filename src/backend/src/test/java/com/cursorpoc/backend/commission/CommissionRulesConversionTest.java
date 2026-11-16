package com.cursorpoc.backend.commission;

import static org.assertj.core.api.Assertions.assertThat;

import com.cursorpoc.backend.domain.CommissionConfigVersion;
import com.cursorpoc.backend.domain.Professional;
import com.cursorpoc.backend.domain.SalonService;
import com.cursorpoc.backend.domain.ServiceCategory;
import com.cursorpoc.backend.domain.Tax;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.Tier;
import com.cursorpoc.backend.domain.enums.CommissionApplyMode;
import com.cursorpoc.backend.domain.enums.CommissionBaseType;
import com.cursorpoc.backend.domain.enums.CommissionConfigScope;
import com.cursorpoc.backend.domain.enums.CommissionRuleOrigin;
import com.cursorpoc.backend.domain.enums.CommissionVersionStatus;
import com.cursorpoc.backend.domain.enums.ServiceKind;
import com.cursorpoc.backend.repository.CommissionConfigVersionRepository;
import com.cursorpoc.backend.repository.ProfessionalRepository;
import com.cursorpoc.backend.repository.SalonServiceRepository;
import com.cursorpoc.backend.repository.ServiceCategoryRepository;
import com.cursorpoc.backend.repository.TaxRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.repository.TierRepository;
import com.cursorpoc.backend.web.dto.CommissionDtos.GroupAssignment;
import java.math.BigDecimal;
import java.sql.Connection;
import java.time.Instant;
import java.util.List;
import javax.sql.DataSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * HU-COM-20: the one-time conversion of the rules that already exist (Flyway V101) against the real
 * mapping (H2): the retention of a rule is folded into its %, a professional that retained through
 * her rules gets her own retention, and her rules by group become rules by service.
 */
@SpringBootTest
@ActiveProfiles("test")
class CommissionRulesConversionTest {

  private static final Instant LONG_AGO = Instant.parse("2026-01-01T00:00:00Z");

  @Autowired private DataSource dataSource;
  @Autowired private TenantRepository tenantRepository;
  @Autowired private TierRepository tierRepository;
  @Autowired private ProfessionalRepository professionalRepository;
  @Autowired private ServiceCategoryRepository categoryRepository;
  @Autowired private SalonServiceRepository serviceRepository;
  @Autowired private TaxRepository taxRepository;
  @Autowired private CommissionConfigVersionRepository versionRepository;
  @Autowired private CommissionGroupService groupService;
  @Autowired private CommissionLedger ledger;

  private Tenant tenant;
  private Professional gaby;
  private Professional jorgelina;
  private SalonService largo;
  private SalonService mediano;
  private SalonService pestanas;
  private long brushing;
  private long lashes;
  private Tax iva;

  @BeforeEach
  void setUp() {
    Tier tier = new Tier();
    tier.setName("tier " + System.nanoTime());
    tier = tierRepository.save(tier);
    Tenant t = new Tenant();
    t.setName("Salon " + System.nanoTime());
    t.setTier(tier);
    tenant = tenantRepository.save(t);
    gaby = professional("Gaby");
    jorgelina = professional("Jorgelina");
    iva = new Tax();
    iva.setTenant(tenant);
    iva.setName("IVA 10");
    iva.setRate(BigDecimal.TEN);
    iva.setActive(true);
    iva = taxRepository.save(iva);
    largo = item("Brushing pelo largo");
    mediano = item("Brushing pelo mediano");
    pestanas = item("Pestañas pelo a pelo");
    brushing = groupService.create(tenant.getId(), "Brushing").id();
    lashes = groupService.create(tenant.getId(), "Pestañas").id();
    groupService.assign(
        tenant.getId(),
        List.of(
            new GroupAssignment(largo.getId(), brushing),
            new GroupAssignment(mediano.getId(), brushing),
            new GroupAssignment(pestanas.getId(), lashes)));
  }

  private Professional professional(String name) {
    Professional p = new Professional();
    p.setTenant(tenant);
    p.setFullName(name);
    p.setActive(true);
    return professionalRepository.save(p);
  }

  private SalonService item(String name) {
    ServiceCategory c = new ServiceCategory();
    c.setTenant(tenant);
    c.setName(name + " cat " + System.nanoTime());
    c.setActive(true);
    c.setKind(ServiceKind.SERVICE);
    c = categoryRepository.save(c);
    SalonService s = new SalonService();
    s.setTenant(tenant);
    s.setCategory(c);
    s.setName(name);
    s.setPriceMinor(BigDecimal.valueOf(100_000));
    s.setDurationMinutes(30);
    s.setActive(true);
    s.setKind(ServiceKind.SERVICE);
    s.setTax(iva);
    return serviceRepository.save(s);
  }

  private CommissionConfigVersion version(
      CommissionConfigScope scope,
      Long serviceId,
      Long professionalId,
      Long groupId,
      String value) {
    CommissionConfigVersion v = new CommissionConfigVersion();
    v.setTenantId(tenant.getId());
    v.setScope(scope);
    v.setServiceId(serviceId);
    v.setProfessionalId(professionalId);
    v.setGroupId(groupId);
    v.setConfigValue(value);
    v.setEffectiveFrom(LONG_AGO);
    v.setApplyMode(CommissionApplyMode.IMMEDIATE);
    v.setStatus(CommissionVersionStatus.ACTIVE);
    v.setCreatedAt(LONG_AGO);
    v.setCreatedByEmail("admin@test");
    return versionRepository.save(v);
  }

  private void legacySalon(boolean aguinaldo) {
    version(CommissionConfigScope.BASE, null, null, null, "TAX_INCLUDED");
    version(CommissionConfigScope.AGUINALDO_ENABLED, null, null, null, String.valueOf(aguinaldo));
    // The way the rules were stored before: pay | retention | fixed | destination, per
    // professional.
    version(CommissionConfigScope.GROUP_RULE, null, gaby.getId(), brushing, "45.00|5.00|0|");
    version(CommissionConfigScope.GROUP_RULE, null, gaby.getId(), lashes, "45.00|5.00|20000|P");
    version(CommissionConfigScope.GROUP_RULE, null, jorgelina.getId(), brushing, "50.00");
    // She already had a rule for one service: it is the most specific and stays as it is.
    version(CommissionConfigScope.RULE, mediano.getId(), gaby.getId(), null, "60.00");
  }

  private CommissionConfigSnapshot convert() throws Exception {
    try (Connection c = dataSource.getConnection()) {
      CommissionRulesConversion.Result r = CommissionRulesConversion.convert(c);
      assertThat(r.retiredGroupRules()).isGreaterThanOrEqualTo(0);
    }
    return ledger.snapshot(tenant.getId());
  }

  private CommissionCalculator.Resolution resolve(
      CommissionConfigSnapshot snap, SalonService s, Long group, Professional p) {
    return CommissionCalculator.resolve(
        snap, s.getId(), group, ServiceKind.SERVICE, p.getId(), Instant.now());
  }

  @Test
  void whatEachProfessionalIsPaidAndRetainedStaysTheSame() throws Exception {
    legacySalon(true);
    CommissionConfigSnapshot snap = convert();

    // Gaby · brushing pelo largo: 45 % paid + 5 % retained, as before (now 50 % and her 5 %).
    CommissionCalculator.Resolution g = resolve(snap, largo, brushing, gaby);
    assertThat(g.percent()).isEqualByComparingTo("45");
    assertThat(g.retentionPercent()).isEqualByComparingTo("5");
    assertThat(g.origin()).isEqualTo(CommissionRuleOrigin.BENEFICIARY_ITEM);
    // Gaby · pestañas with 20.000 for her on top.
    CommissionCalculator.Resolution l = resolve(snap, pestanas, lashes, gaby);
    assertThat(l.percent()).isEqualByComparingTo("45");
    assertThat(l.retentionPercent()).isEqualByComparingTo("5");
    assertThat(l.fixedAmount()).isEqualByComparingTo("20000");
    assertThat(l.fixedToProfessional()).isTrue();
    // The rule she already had for one service is untouched (60 % total, she retains 5 of it).
    CommissionCalculator.Resolution m = resolve(snap, mediano, brushing, gaby);
    assertThat(m.percent()).isEqualByComparingTo("55");
    // Jorgelina retained nothing and is paid 50 % in the whole group.
    CommissionCalculator.Resolution j = resolve(snap, largo, brushing, jorgelina);
    assertThat(j.percent()).isEqualByComparingTo("50");
    assertThat(j.retentionPercent()).isEqualByComparingTo("0");
    assertThat(resolve(snap, mediano, brushing, jorgelina).percent()).isEqualByComparingTo("50");
  }

  @Test
  void aProfessionalThatRetainedThroughHerRulesGetsHerOwnRetention() throws Exception {
    legacySalon(true);
    CommissionConfigSnapshot snap = convert();
    assertThat(snap.retentionProfileAt(gaby.getId(), Instant.now())).isEqualByComparingTo("5");
    assertThat(snap.retentionProfileAt(jorgelina.getId(), Instant.now())).isNull();
  }

  @Test
  void herGroupRulesBecomeRulesByServiceAndTheGroupRulesAreRetired() throws Exception {
    legacySalon(true);
    CommissionConfigSnapshot snap = convert();
    Instant now = Instant.now();
    // One rule per service the group has, with the retention folded into the %.
    assertThat(snap.ruleAt(largo.getId(), gaby.getId(), now)).isPresent();
    assertThat(snap.ruleAt(largo.getId(), gaby.getId(), now).get().getConfigValue())
        .isEqualTo("50.00");
    assertThat(snap.ruleAt(pestanas.getId(), gaby.getId(), now).get().getConfigValue())
        .isEqualTo("50.00|0.00|20000|P");
    // The rule that existed for «pelo mediano» was not overwritten.
    assertThat(snap.ruleAt(mediano.getId(), gaby.getId(), now).get().getConfigValue())
        .isEqualTo("60.00");
    // The group rules of a professional are no longer active (kept in the history).
    assertThat(snap.groupRuleAt(brushing, gaby.getId(), now)).isEmpty();
    assertThat(snap.groupRuleAt(lashes, gaby.getId(), now)).isEmpty();
    assertThat(
            versionRepository.findByTenantIdOrderByCreatedAtDescIdDesc(tenant.getId()).stream()
                .filter(v -> v.getScope() == CommissionConfigScope.GROUP_RULE)
                .allMatch(v -> v.getStatus() == CommissionVersionStatus.CANCELLED))
        .isTrue();
  }

  @Test
  void withoutAguinaldoTheRetentionOfTheRulesIsJustDropped() throws Exception {
    legacySalon(false);
    CommissionConfigSnapshot snap = convert();
    // The retention was not applied, so what is paid stays 45 % (not 50) and nobody gets a %.
    CommissionCalculator.Resolution g = resolve(snap, largo, brushing, gaby);
    assertThat(g.percent()).isEqualByComparingTo("45");
    assertThat(g.retentionPercent()).isEqualByComparingTo("0");
    assertThat(snap.retentionProfileAt(gaby.getId(), Instant.now())).isNull();
  }

  @Test
  void theBaseIsNotTouched() throws Exception {
    legacySalon(true);
    CommissionConfigSnapshot snap = convert();
    assertThat(snap.baseAt(Instant.now())).isEqualTo(CommissionBaseType.TAX_INCLUDED);
  }
}
