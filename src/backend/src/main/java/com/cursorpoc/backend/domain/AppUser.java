package com.cursorpoc.backend.domain;

import com.cursorpoc.backend.domain.enums.UserRole;
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
import jakarta.persistence.UniqueConstraint;

@Entity
@Table(
    name = "app_users",
    uniqueConstraints = @UniqueConstraint(columnNames = {"tenant_id", "email"}))
public class AppUser {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  // HU-34: nullable — PLATFORM_ADMIN is genuinely tenant-independent (tenant == null). Every
  // other role still requires a tenant; that invariant is enforced where such users are created
  // (AuthService, FemmeDataInitializer), not at the JPA/DB level, to keep this entity simple.
  @ManyToOne(fetch = FetchType.LAZY, optional = true)
  @JoinColumn(name = "tenant_id", nullable = true)
  private Tenant tenant;

  @Column(nullable = false, length = 320)
  private String email;

  @Column(name = "password_hash", nullable = false)
  private String passwordHash;

  @Enumerated(EnumType.STRING)
  @Column(nullable = false, length = 64)
  private UserRole role;

  @Column(nullable = false)
  private boolean enabled = true;

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

  public String getEmail() {
    return email;
  }

  public void setEmail(String email) {
    this.email = email;
  }

  public String getPasswordHash() {
    return passwordHash;
  }

  public void setPasswordHash(String passwordHash) {
    this.passwordHash = passwordHash;
  }

  public UserRole getRole() {
    return role;
  }

  public void setRole(UserRole role) {
    this.role = role;
  }

  public boolean isEnabled() {
    return enabled;
  }

  public void setEnabled(boolean enabled) {
    this.enabled = enabled;
  }

  public Long getTenantId() {
    return tenant == null ? null : tenant.getId();
  }
}
