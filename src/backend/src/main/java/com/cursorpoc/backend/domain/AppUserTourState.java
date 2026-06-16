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
import java.time.Instant;

@Entity
@Table(name = "app_user_tour_state")
public class AppUserTourState {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "user_id", nullable = false)
  private AppUser user;

  @Column(name = "tour_key", nullable = false, length = 100)
  private String tourKey;

  @Column(name = "seen_at", nullable = false)
  private Instant seenAt;

  public Long getId() {
    return id;
  }

  public void setId(Long id) {
    this.id = id;
  }

  public AppUser getUser() {
    return user;
  }

  public void setUser(AppUser user) {
    this.user = user;
  }

  public String getTourKey() {
    return tourKey;
  }

  public void setTourKey(String tourKey) {
    this.tourKey = tourKey;
  }

  public Instant getSeenAt() {
    return seenAt;
  }

  public void setSeenAt(Instant seenAt) {
    this.seenAt = seenAt;
  }
}
