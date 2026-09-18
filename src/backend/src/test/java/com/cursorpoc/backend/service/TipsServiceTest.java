package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.domain.AppUser;
import com.cursorpoc.backend.domain.CashMovement;
import com.cursorpoc.backend.domain.CashSession;
import com.cursorpoc.backend.domain.Professional;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.TipWithdrawal;
import com.cursorpoc.backend.domain.enums.CashMovementType;
import com.cursorpoc.backend.domain.enums.ServiceRecordStatus;
import com.cursorpoc.backend.repository.AppUserRepository;
import com.cursorpoc.backend.repository.CashMovementRepository;
import com.cursorpoc.backend.repository.CashSessionRepository;
import com.cursorpoc.backend.repository.ProfessionalRepository;
import com.cursorpoc.backend.repository.ServiceRecordTipRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.repository.TipWithdrawalRepository;
import com.cursorpoc.backend.web.dto.CreateTipWithdrawalResponse;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class TipsServiceTest {

  @Mock private ServiceRecordTipRepository serviceRecordTipRepository;
  @Mock private TipWithdrawalRepository tipWithdrawalRepository;
  @Mock private ProfessionalRepository professionalRepository;
  @Mock private TenantRepository tenantRepository;
  @Mock private AppUserRepository appUserRepository;
  @Mock private CashSessionRepository cashSessionRepository;
  @Mock private CashMovementRepository cashMovementRepository;

  @InjectMocks private TipsService service;

  private Tenant tenant;
  private AppUser user;
  private Professional professional;

  @BeforeEach
  void setUp() {
    tenant = new Tenant();
    tenant.setId(1L);
    tenant.setName("Demo");

    user = new AppUser();
    user.setId(10L);
    user.setEmail("admin@demo.com");

    professional = new Professional();
    professional.setId(20L);
    professional.setFullName("Ana");
    professional.setActive(true);

    when(professionalRepository.findByIdAndTenant_Id(20L, 1L))
        .thenReturn(Optional.of(professional));
    when(serviceRecordTipRepository.sumForProfessional(1L, 20L, ServiceRecordStatus.CLOSED))
        .thenReturn(new BigDecimal("50000.00"));
    when(tipWithdrawalRepository.sumForProfessional(1L, 20L)).thenReturn(BigDecimal.ZERO);
    when(tenantRepository.findById(1L)).thenReturn(Optional.of(tenant));
    when(appUserRepository.findById(10L)).thenReturn(Optional.of(user));
  }

  @Test
  void createWithdrawal_withOpenSession_autoCreatesLinkedCashMovement() {
    CashSession openSession = new CashSession();
    openSession.setId(7L);
    openSession.setTenant(tenant);
    when(cashSessionRepository.findFirstByTenant_IdAndClosedAtIsNullOrderByOpenedAtDesc(1L))
        .thenReturn(Optional.of(openSession));
    when(tipWithdrawalRepository.save(any(TipWithdrawal.class)))
        .thenAnswer(
            inv -> {
              TipWithdrawal w = inv.getArgument(0);
              w.setId(99L);
              return w;
            });

    CreateTipWithdrawalResponse response =
        service.createWithdrawal(1L, 10L, 20L, new BigDecimal("5000.00"));

    assertThat(response.newBalance()).isEqualByComparingTo("45000.00");

    ArgumentCaptor<CashMovement> captor = ArgumentCaptor.forClass(CashMovement.class);
    verify(cashMovementRepository).save(captor.capture());
    CashMovement movement = captor.getValue();
    assertThat(movement.getCashSession()).isEqualTo(openSession);
    assertThat(movement.getType()).isEqualTo(CashMovementType.TIP_WITHDRAWAL_OUT);
    assertThat(movement.getAmount()).isEqualByComparingTo("5000.00");
    assertThat(movement.getTipWithdrawalId()).isEqualTo(99L);
    assertThat(movement.getCreatedAt()).isInstanceOf(Instant.class);
  }

  @Test
  void createWithdrawal_withNoOpenSession_createsNoCashMovement() {
    when(cashSessionRepository.findFirstByTenant_IdAndClosedAtIsNullOrderByOpenedAtDesc(1L))
        .thenReturn(Optional.empty());

    CreateTipWithdrawalResponse response =
        service.createWithdrawal(1L, 10L, 20L, new BigDecimal("5000.00"));

    assertThat(response.newBalance()).isEqualByComparingTo("45000.00");
    verify(cashMovementRepository, never()).save(any());
  }
}
