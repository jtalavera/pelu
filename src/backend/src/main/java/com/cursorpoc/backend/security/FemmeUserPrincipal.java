package com.cursorpoc.backend.security;

import com.cursorpoc.backend.domain.enums.UserRole;
import java.util.Collection;
import java.util.List;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;

public class FemmeUserPrincipal implements UserDetails {

  private final long userId;
  // HU-34: nullable — a PLATFORM_ADMIN token carries no `tid` claim at all. Every other role is
  // guaranteed non-null: JwtAuthenticationFilter never authenticates a tenant-less token against
  // any route outside the platform/auth allowlist, so getTenantId() below never actually throws
  // for the 200+ existing tenant-scoped call sites.
  private final Long tenantId;
  private final String email;
  private final UserRole role;
  private final Long professionalId;
  // Issue #310: true only for a Platform Admin impersonating a tenant (JwtService "imp" claim).
  private final boolean impersonation;
  // HU-66: set only for a professional session opened with her PIN on a shared device — the
  // device that issued it and the PIN version it was issued for (JwtService "pin"/"pv" claims).
  private final Long pinDeviceId;
  private final int pinVersion;

  public FemmeUserPrincipal(
      long userId, Long tenantId, String email, UserRole role, Long professionalId) {
    this(userId, tenantId, email, role, professionalId, false);
  }

  public FemmeUserPrincipal(
      long userId,
      Long tenantId,
      String email,
      UserRole role,
      Long professionalId,
      boolean impersonation) {
    this(userId, tenantId, email, role, professionalId, impersonation, null, 0);
  }

  public FemmeUserPrincipal(
      long userId,
      Long tenantId,
      String email,
      UserRole role,
      Long professionalId,
      boolean impersonation,
      Long pinDeviceId,
      int pinVersion) {
    this.userId = userId;
    this.tenantId = tenantId;
    this.email = email;
    this.role = role;
    this.professionalId = professionalId;
    this.impersonation = impersonation;
    this.pinDeviceId = pinDeviceId;
    this.pinVersion = pinVersion;
  }

  /** HU-66: a PROFESSIONAL session opened with a PIN on a shared device (calendar only). */
  public static FemmeUserPrincipal pinSession(
      long tenantId, long professionalId, long deviceId, int pinVersion) {
    return new FemmeUserPrincipal(
        0L,
        tenantId,
        pinSessionUsername(professionalId, deviceId),
        UserRole.PROFESSIONAL,
        professionalId,
        false,
        deviceId,
        pinVersion);
  }

  /** How a PIN session shows up as "user" (e.g. in the audit trail): professional + device. */
  public static String pinSessionUsername(long professionalId, long deviceId) {
    return "pin:professional-" + professionalId + "@device-" + deviceId;
  }

  public boolean isPinSession() {
    return pinDeviceId != null;
  }

  public Long getPinDeviceId() {
    return pinDeviceId;
  }

  public int getPinVersion() {
    return pinVersion;
  }

  public long getUserId() {
    return userId;
  }

  /**
   * @throws IllegalStateException if this principal has no tenant (PLATFORM_ADMIN). Existing
   *     tenant-scoped controllers/services can keep calling this unconditionally, as before HU-34 —
   *     routing already guarantees a tenant is present by the time they run. Platform-scoped code
   *     must use {@link #hasTenant()} / {@link #getTenantIdOrNull()} instead.
   */
  public long getTenantId() {
    if (tenantId == null) {
      throw new IllegalStateException("PLATFORM_ADMIN_HAS_NO_TENANT");
    }
    return tenantId;
  }

  public boolean hasTenant() {
    return tenantId != null;
  }

  public Long getTenantIdOrNull() {
    return tenantId;
  }

  public UserRole getRole() {
    return role;
  }

  public Long getProfessionalId() {
    return professionalId;
  }

  public boolean isAdmin() {
    return role == UserRole.ADMIN;
  }

  public boolean isProfessional() {
    return role == UserRole.PROFESSIONAL;
  }

  public boolean isPlatformAdmin() {
    return role == UserRole.PLATFORM_ADMIN;
  }

  /**
   * Issue #310: a Platform Admin working inside a tenant as its {@code ADMIN} (impersonation). The
   * role is {@code ADMIN} — never {@code PLATFORM_ADMIN}, so no platform route accepts this token —
   * while {@link #getUserId()}/{@link #getUsername()} still identify the Platform Admin.
   */
  public boolean isImpersonation() {
    return impersonation;
  }

  @Override
  public Collection<? extends GrantedAuthority> getAuthorities() {
    return List.of(new SimpleGrantedAuthority("ROLE_" + role.name()));
  }

  @Override
  public String getPassword() {
    return "";
  }

  @Override
  public String getUsername() {
    return email;
  }

  @Override
  public boolean isAccountNonExpired() {
    return true;
  }

  @Override
  public boolean isAccountNonLocked() {
    return true;
  }

  @Override
  public boolean isCredentialsNonExpired() {
    return true;
  }

  @Override
  public boolean isEnabled() {
    return true;
  }
}
