package com.cursorpoc.backend.security;

import com.cursorpoc.backend.domain.enums.UserRole;
import java.util.Collection;
import java.util.List;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;

public class FemmeUserPrincipal implements UserDetails {

  private final long userId;
  private final long tenantId;
  private final String email;
  private final UserRole role;
  private final Long professionalId;

  public FemmeUserPrincipal(long userId, long tenantId, String email, UserRole role, Long professionalId) {
    this.userId = userId;
    this.tenantId = tenantId;
    this.email = email;
    this.role = role;
    this.professionalId = professionalId;
  }

  public long getUserId() {
    return userId;
  }

  public long getTenantId() {
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
