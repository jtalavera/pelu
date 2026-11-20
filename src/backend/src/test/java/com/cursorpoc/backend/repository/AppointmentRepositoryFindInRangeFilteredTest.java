package com.cursorpoc.backend.repository;

import static org.assertj.core.api.Assertions.assertThat;

import com.cursorpoc.backend.domain.Appointment;
import com.cursorpoc.backend.domain.Client;
import com.cursorpoc.backend.domain.Professional;
import com.cursorpoc.backend.domain.SalonService;
import com.cursorpoc.backend.domain.ServiceCategory;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.Tier;
import com.cursorpoc.backend.domain.enums.AppointmentStatus;
import jakarta.persistence.EntityManager;
import jakarta.persistence.EntityManagerFactory;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import org.hibernate.SessionFactory;
import org.hibernate.stat.Statistics;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

/**
 * The agenda's {@code findInRangeFiltered} must load client, professional and service in the same
 * query: the response mapper reads all three for every turno (staging load test, 2026-11-15: ~16
 * single-row client lookups per agenda request).
 */
@SpringBootTest
@ActiveProfiles("test")
@Transactional
class AppointmentRepositoryFindInRangeFilteredTest {

  @Autowired private TierRepository tierRepository;
  @Autowired private TenantRepository tenantRepository;
  @Autowired private ClientRepository clientRepository;
  @Autowired private ProfessionalRepository professionalRepository;
  @Autowired private ServiceCategoryRepository serviceCategoryRepository;
  @Autowired private SalonServiceRepository salonServiceRepository;
  @Autowired private AppointmentRepository appointmentRepository;
  @Autowired private EntityManagerFactory entityManagerFactory;
  @Autowired private EntityManager entityManager;

  private static final Instant FROM = Instant.parse("2026-11-16T00:00:00Z");

  @Test
  void loadsClientProfessionalAndServiceInOneQuery_andKeepsWalkIns() {
    Tenant tenant = tenant();
    Professional pro = professional(tenant);
    SalonService service = service(tenant);
    for (int i = 0; i < 8; i++) {
      appointment(tenant, client(tenant, i), pro, service, i);
    }
    appointment(tenant, null, pro, service, 8); // walk-in: no client must not drop the turno
    entityManager.flush();
    entityManager.clear();

    Statistics stats = entityManagerFactory.unwrap(SessionFactory.class).getStatistics();
    stats.setStatisticsEnabled(true);
    stats.clear();

    List<Appointment> found =
        appointmentRepository.findInRangeFiltered(
            tenant.getId(), FROM, FROM.plusSeconds(7 * 86400L), null, null);
    for (Appointment a : found) {
      if (a.getClient() != null) {
        a.getClient().getFullName();
      }
      a.getProfessional().getDisplayName();
      a.getSalonService().getName();
    }

    assertThat(found).hasSize(9);
    assertThat(found).extracting(Appointment::getStartAt).isSorted();
    assertThat(stats.getPrepareStatementCount()).isEqualTo(1);
  }

  @Test
  void stillFiltersByProfessionalAndClient() {
    Tenant tenant = tenant();
    Professional pro = professional(tenant);
    Professional other = professional(tenant);
    SalonService service = service(tenant);
    Client c1 = client(tenant, 1);
    Client c2 = client(tenant, 2);
    Appointment mine = appointment(tenant, c1, pro, service, 0);
    appointment(tenant, c2, pro, service, 1);
    appointment(tenant, c1, other, service, 2);
    entityManager.flush();

    Instant to = FROM.plusSeconds(7 * 86400L);
    assertThat(
            appointmentRepository.findInRangeFiltered(
                tenant.getId(), FROM, to, pro.getId(), c1.getId()))
        .extracting(Appointment::getId)
        .containsExactly(mine.getId());
  }

  private Tenant tenant() {
    String n = String.valueOf(System.nanoTime());
    Tier tier = new Tier();
    tier.setName("Tier " + n);
    tier = tierRepository.save(tier);
    Tenant t = new Tenant();
    t.setName("Tenant " + n);
    t.setTier(tier);
    return tenantRepository.save(t);
  }

  private Client client(Tenant tenant, int i) {
    Client c = new Client();
    c.setTenant(tenant);
    c.setFullName("Cliente " + i);
    c.setActive(true);
    return clientRepository.save(c);
  }

  private Professional professional(Tenant tenant) {
    Professional p = new Professional();
    p.setTenant(tenant);
    p.setFullName("Profesional " + System.nanoTime());
    p.setActive(true);
    return professionalRepository.save(p);
  }

  private SalonService service(Tenant tenant) {
    ServiceCategory category = new ServiceCategory();
    category.setTenant(tenant);
    category.setName("Cat " + System.nanoTime());
    category.setActive(true);
    category = serviceCategoryRepository.save(category);
    SalonService s = new SalonService();
    s.setTenant(tenant);
    s.setCategory(category);
    s.setName("Corte");
    s.setPriceMinor(new BigDecimal("50000"));
    s.setDurationMinutes(30);
    s.setActive(true);
    return salonServiceRepository.save(s);
  }

  private Appointment appointment(
      Tenant tenant, Client client, Professional pro, SalonService service, int hour) {
    Appointment a = new Appointment();
    a.setTenant(tenant);
    a.setClient(client);
    a.setProfessional(pro);
    a.setSalonService(service);
    Instant start = FROM.plusSeconds(3600L * (hour + 9));
    a.setStartAt(start);
    a.setEndAt(start.plusSeconds(1800));
    a.setStatus(AppointmentStatus.PENDING);
    return appointmentRepository.save(a);
  }
}
