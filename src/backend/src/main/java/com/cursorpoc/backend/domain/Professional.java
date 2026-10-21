package com.cursorpoc.backend.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;

@Entity
@Table(name = "professionals")
public class Professional {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "tenant_id", nullable = false)
  private Tenant tenant;

  @Column(name = "full_name", nullable = false)
  private String fullName;

  @Column(length = 64)
  private String phone;

  @Column(length = 320)
  private String email;

  @Column(length = 255)
  private String address;

  @Column(name = "photo_data_url", columnDefinition = "NVARCHAR(MAX)")
  private String photoDataUrl;

  @Column(nullable = false)
  private boolean active;

  @Column(name = "pin_fingerprint", length = 64)
  private String pinFingerprint;

  // HU-66: BCrypt hash of the PIN, used to verify PIN logins (pinFingerprint above only backs the
  // per-tenant uniqueness check). Null for PINs set before HU-66 until their first PIN login.
  @Column(name = "pin_hash", length = 100)
  private String pinHash;

  // HU-66: bumped whenever the PIN changes or is cleared — open PIN sessions carry the version they
  // were issued with and stop working on mismatch.
  @Column(name = "pin_version", nullable = false)
  private int pinVersion;

  @Column(name = "system_access_allowed", nullable = false)
  private boolean systemAccessAllowed = false;

  @ManyToOne(fetch = FetchType.LAZY)
  @JoinColumn(name = "user_id")
  private AppUser user;

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

  public String getFullName() {
    return fullName;
  }

  public void setFullName(String fullName) {
    this.fullName = fullName;
  }

  public String getPhone() {
    return phone;
  }

  public void setPhone(String phone) {
    this.phone = phone;
  }

  public String getEmail() {
    return email;
  }

  public void setEmail(String email) {
    this.email = email;
  }

  public String getAddress() {
    return address;
  }

  public void setAddress(String address) {
    this.address = address;
  }

  public String getPhotoDataUrl() {
    return photoDataUrl;
  }

  public void setPhotoDataUrl(String photoDataUrl) {
    this.photoDataUrl = photoDataUrl;
  }

  public boolean isActive() {
    return active;
  }

  public void setActive(boolean active) {
    this.active = active;
  }

  public String getPinFingerprint() {
    return pinFingerprint;
  }

  public void setPinFingerprint(String pinFingerprint) {
    this.pinFingerprint = pinFingerprint;
  }

  public boolean isSystemAccessAllowed() {
    return systemAccessAllowed;
  }

  public void setSystemAccessAllowed(boolean systemAccessAllowed) {
    this.systemAccessAllowed = systemAccessAllowed;
  }

  public AppUser getUser() {
    return user;
  }

  public void setUser(AppUser user) {
    this.user = user;
  }

  public String getPinHash() {
    return pinHash;
  }

  public void setPinHash(String pinHash) {
    this.pinHash = pinHash;
  }

  public int getPinVersion() {
    return pinVersion;
  }

  public void setPinVersion(int pinVersion) {
    this.pinVersion = pinVersion;
  }

  /** HU-66: whether a PIN is set (it can be used to log in on a shared device). */
  public boolean hasPin() {
    return pinFingerprint != null;
  }
}
