package com.cursorpoc.backend.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * Issue #284: one row of the audit trail — who ({@link #userEmail}, {@link #userRole}) did what
 * ({@link #httpMethod} + {@link #resource}/{@link #operation}) on which record ({@link #entityId})
 * and when. Never holds a request body. {@link #tenantId} is {@code null} for platform (root)
 * actions. Plain ids instead of relations: the trail must outlive the rows it describes.
 */
@Entity
@Table(name = "audit_log")
public class AuditLog {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(name = "tenant_id")
  private Long tenantId;

  @Column(name = "user_id")
  private Long userId;

  @Column(name = "user_email", length = 255)
  private String userEmail;

  @Column(name = "user_role", length = 32)
  private String userRole;

  @Column(name = "http_method", length = 8, nullable = false)
  private String httpMethod;

  /** First literal segment of the endpoint after {@code /api} (e.g. {@code invoices}). */
  @Column(length = 64, nullable = false)
  private String resource;

  /** Trailing literal segment, when the endpoint is an action (e.g. {@code void}); else null. */
  @Column(length = 64)
  private String operation;

  /** The endpoint's URL template, e.g. {@code /api/invoices/{id}/void}. */
  @Column(name = "path_pattern", length = 255, nullable = false)
  private String pathPattern;

  /** The id taken from the URL (the affected record), when the endpoint has one. */
  @Column(name = "entity_id", length = 64)
  private String entityId;

  @Column(name = "status_code", nullable = false)
  private int statusCode;

  @JdbcTypeCode(SqlTypes.TIMESTAMP)
  @Column(name = "created_at", nullable = false)
  private Instant createdAt;

  public Long getId() {
    return id;
  }

  public void setId(Long id) {
    this.id = id;
  }

  public Long getTenantId() {
    return tenantId;
  }

  public void setTenantId(Long tenantId) {
    this.tenantId = tenantId;
  }

  public Long getUserId() {
    return userId;
  }

  public void setUserId(Long userId) {
    this.userId = userId;
  }

  public String getUserEmail() {
    return userEmail;
  }

  public void setUserEmail(String userEmail) {
    this.userEmail = userEmail;
  }

  public String getUserRole() {
    return userRole;
  }

  public void setUserRole(String userRole) {
    this.userRole = userRole;
  }

  public String getHttpMethod() {
    return httpMethod;
  }

  public void setHttpMethod(String httpMethod) {
    this.httpMethod = httpMethod;
  }

  public String getResource() {
    return resource;
  }

  public void setResource(String resource) {
    this.resource = resource;
  }

  public String getOperation() {
    return operation;
  }

  public void setOperation(String operation) {
    this.operation = operation;
  }

  public String getPathPattern() {
    return pathPattern;
  }

  public void setPathPattern(String pathPattern) {
    this.pathPattern = pathPattern;
  }

  public String getEntityId() {
    return entityId;
  }

  public void setEntityId(String entityId) {
    this.entityId = entityId;
  }

  public int getStatusCode() {
    return statusCode;
  }

  public void setStatusCode(int statusCode) {
    this.statusCode = statusCode;
  }

  public Instant getCreatedAt() {
    return createdAt;
  }

  public void setCreatedAt(Instant createdAt) {
    this.createdAt = createdAt;
  }
}
