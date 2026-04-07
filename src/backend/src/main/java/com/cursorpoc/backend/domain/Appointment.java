package com.cursorpoc.backend.domain;

import com.cursorpoc.backend.domain.enums.AppointmentStatus;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import java.time.Instant;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "appointments")
public class Appointment {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "tenant_id", nullable = false)
  private Tenant tenant;

  @ManyToOne(fetch = FetchType.LAZY)
  @JoinColumn(name = "client_id")
  private Client client;

  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "professional_id", nullable = false)
  private Professional professional;

  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "service_id", nullable = false)
  private SalonService salonService;

  @JdbcTypeCode(SqlTypes.TIMESTAMP)
  @Column(name = "start_at", nullable = false)
  private Instant startAt;

  @JdbcTypeCode(SqlTypes.TIMESTAMP)
  @Column(name = "end_at", nullable = false)
  private Instant endAt;

  @Enumerated(EnumType.STRING)
  @Column(nullable = false, length = 32)
  private AppointmentStatus status;

  @Column(name = "cancel_reason", length = 500)
  private String cancelReason;

  public Long getId() {
    return id;
  }

  public void setId(Long id) {
    this.id = id;
  }

  public Tenant getTenant() {
    return tenant;
  }

  public void setTenant(Tenant tenant) {
    this.tenant = tenant;
  }

  public Client getClient() {
    return client;
  }

  public void setClient(Client client) {
    this.client = client;
  }

  public Professional getProfessional() {
    return professional;
  }

  public void setProfessional(Professional professional) {
    this.professional = professional;
  }

  public SalonService getSalonService() {
    return salonService;
  }

  public void setSalonService(SalonService salonService) {
    this.salonService = salonService;
  }

  public Instant getStartAt() {
    return startAt;
  }

  public void setStartAt(Instant startAt) {
    this.startAt = startAt;
  }

  public Instant getEndAt() {
    return endAt;
  }

  public void setEndAt(Instant endAt) {
    this.endAt = endAt;
  }

  public AppointmentStatus getStatus() {
    return status;
  }

  public void setStatus(AppointmentStatus status) {
    this.status = status;
  }

  public String getCancelReason() {
    return cancelReason;
  }

  public void setCancelReason(String cancelReason) {
    this.cancelReason = cancelReason;
  }
}
