package com.cursorpoc.backend.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;

/**
 * HU-46 (Épica D — Tiers y Feature Flags): a feature flag included in a {@link Tier}'s default
 * package (PRD "Tier": "usada para dar de alta un paquete por defecto de feature flags"). A row's
 * presence means the flag is part of the tier's package; its absence means the tier has no opinion
 * for that flag and the global default applies (see {@code FeatureFlagService}). Sits alongside the
 * existing HU-49 override chain ({@link FeatureFlag} + {@link TenantFeatureFlag}) without replacing
 * it — consuming this table in the 3-level resolution is HU-47, out of this entity's scope.
 */
@Entity
@Table(
    name = "tier_feature_flags",
    uniqueConstraints = @UniqueConstraint(columnNames = {"tier_id", "flag_key"}))
public class TierFeatureFlag {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(name = "tier_id", nullable = false)
  private Long tierId;

  @Column(name = "flag_key", nullable = false, length = 100)
  private String flagKey;

  @Column(nullable = false)
  private boolean enabled;

  public Long getId() {
    return id;
  }

  public void setId(Long id) {
    this.id = id;
  }

  public Long getTierId() {
    return tierId;
  }

  public void setTierId(Long tierId) {
    this.tierId = tierId;
  }

  public String getFlagKey() {
    return flagKey;
  }

  public void setFlagKey(String flagKey) {
    this.flagKey = flagKey;
  }

  public boolean isEnabled() {
    return enabled;
  }

  public void setEnabled(boolean enabled) {
    this.enabled = enabled;
  }
}
