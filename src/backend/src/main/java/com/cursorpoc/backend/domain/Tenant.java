package com.cursorpoc.backend.domain;

import com.cursorpoc.backend.domain.enums.TenantStatus;
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

@Entity
@Table(name = "tenants")
public class Tenant {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(nullable = false)
  private String name;

  // No `unique = true` here on purpose: the real DB-level guarantee is V7's *filtered* unique
  // index (`uq_tenants_domain ... WHERE [domain] IS NOT NULL`), which correctly allows any number
  // of tenants with no domain. `ddl-auto=validate` in prod never re-derives DDL from this
  // annotation, but `create-drop` (e2e/test H2) does — and a plain `@Column(unique = true)` on a
  // nullable column generates a plain UNIQUE constraint that (surfaced by HU-37: multiple tenants
  // with a blank domain, AC-3's "dominio vacío permitido") treats two NULLs as duplicates and
  // rejects the second one. Duplicate *non-null* domains are still rejected — by
  // TenantAdminService.create()'s explicit check first, and by V7's index as the DB-level backstop
  // in every real (non-H2) environment.
  private String domain;

  // HU-37: the tier selected at creation time (HU-45 CRUD). Nullable at the DB/entity level —
  // like `domain` above — so the many pre-existing tenants fabricated directly by tests/seeds
  // (with no tier at all) keep working; the platform "create tenant" endpoint is what actually
  // enforces this as required (AC-1), not the schema.
  @ManyToOne(fetch = FetchType.LAZY)
  @JoinColumn(name = "tier_id")
  private Tier tier;

  // HU-37 AC-4: every tenant is created ACTIVE. HU-40 adds the suspend/reactivate transitions.
  @Enumerated(EnumType.STRING)
  @Column(nullable = false, length = 20)
  private TenantStatus status = TenantStatus.ACTIVE;

  public Long getId() {
    return id;
  }

  public void setId(Long id) {
    this.id = id;
  }

  public String getName() {
    return name;
  }

  public void setName(String name) {
    this.name = name;
  }

  public String getDomain() {
    return domain;
  }

  public void setDomain(String domain) {
    this.domain = domain;
  }

  public Tier getTier() {
    return tier;
  }

  public void setTier(Tier tier) {
    this.tier = tier;
  }

  public TenantStatus getStatus() {
    return status;
  }

  public void setStatus(TenantStatus status) {
    this.status = status;
  }
}
