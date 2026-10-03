package com.cursorpoc.backend.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * Stock integration (HU-61): what pelu knows about a tenant's counterpart in control-stock. A row
 * exists once the tenant was first activated (its {@code TENANT_UPSERT} was enqueued); {@code
 * provisionedAt} is set when Stock confirmed it. {@code flagsVersion} is the monotonic version sent
 * with every {@code STOCK_*} snapshot (push and pull), {@code flagsJson} the last snapshot
 * enqueued.
 */
@Entity
@Table(name = "stock_tenant_link")
public class StockTenantLink {

  @Id
  @Column(name = "tenant_id")
  private Long tenantId;

  @JdbcTypeCode(SqlTypes.TIMESTAMP)
  @Column(name = "provisioned_at")
  private Instant provisionedAt;

  @Column(name = "flags_version", nullable = false)
  private long flagsVersion;

  @Column(name = "flags_json", length = 2000)
  private String flagsJson;

  @JdbcTypeCode(SqlTypes.TIMESTAMP)
  @Column(name = "catalog_synced_at")
  private Instant catalogSyncedAt;

  @Column(name = "last_error", length = 2000)
  private String lastError;

  public Long getTenantId() {
    return tenantId;
  }

  public void setTenantId(Long tenantId) {
    this.tenantId = tenantId;
  }

  public Instant getProvisionedAt() {
    return provisionedAt;
  }

  public void setProvisionedAt(Instant provisionedAt) {
    this.provisionedAt = provisionedAt;
  }

  public long getFlagsVersion() {
    return flagsVersion;
  }

  public void setFlagsVersion(long flagsVersion) {
    this.flagsVersion = flagsVersion;
  }

  public String getFlagsJson() {
    return flagsJson;
  }

  public void setFlagsJson(String flagsJson) {
    this.flagsJson = flagsJson;
  }

  public Instant getCatalogSyncedAt() {
    return catalogSyncedAt;
  }

  public void setCatalogSyncedAt(Instant catalogSyncedAt) {
    this.catalogSyncedAt = catalogSyncedAt;
  }

  public String getLastError() {
    return lastError;
  }

  public void setLastError(String lastError) {
    this.lastError = lastError;
  }
}
