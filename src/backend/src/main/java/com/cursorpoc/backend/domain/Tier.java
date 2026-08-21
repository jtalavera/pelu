package com.cursorpoc.backend.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/**
 * HU-45's entity, introduced ahead of schedule by HU-37: a Platform Admin-defined package of
 * feature flags that tenants can be assigned to (see PRD "Tier" definition). HU-37 only needs a
 * tenant to be able to select an *existing* tier when it's created; full CRUD (create/edit/delete
 * with in-use protection) is HU-45's scope, not this one.
 */
@Entity
@Table(name = "tiers")
public class Tier {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(nullable = false, unique = true)
  private String name;

  @Column(length = 500)
  private String description;

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

  public String getDescription() {
    return description;
  }

  public void setDescription(String description) {
    this.description = description;
  }
}
