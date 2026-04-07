package com.cursorpoc.backend.security;

import java.util.Collection;
import java.util.List;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;

public class FemmeUserPrincipal implements UserDetails {

  private final long userId;
  private final long tenantId;
  private final String email;

  public FemmeUserPrincipal(long userId, long tenantId, String email) {
    this.userId = userId;
    this.tenantId = tenantId;
    this.email = email;
  }

  public long getUserId() {
    return userId;
  }

  public long getTenantId() {
    return tenantId;
  }

  @Override
  public Collection<? extends GrantedAuthority> getAuthorities() {
    return List.of(new SimpleGrantedAuthority("ROLE_ADMIN"));
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
