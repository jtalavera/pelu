package com.cursorpoc.backend.service;

import com.cursorpoc.backend.domain.AppUser;
import com.cursorpoc.backend.domain.AppUserTourState;
import com.cursorpoc.backend.repository.AppUserRepository;
import com.cursorpoc.backend.repository.AppUserTourStateRepository;
import com.cursorpoc.backend.web.dto.TourStateResponse;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class TourStateService {

  private final AppUserRepository appUserRepository;
  private final AppUserTourStateRepository tourStateRepository;

  public TourStateService(
      AppUserRepository appUserRepository, AppUserTourStateRepository tourStateRepository) {
    this.appUserRepository = appUserRepository;
    this.tourStateRepository = tourStateRepository;
  }

  public List<TourStateResponse> listSeenTours(long userId) {
    return tourStateRepository.findByUser_Id(userId).stream()
        .map(s -> new TourStateResponse(s.getTourKey(), s.getSeenAt()))
        .toList();
  }

  @Transactional
  public void markTourSeen(long userId, String tourKey) {
    Optional<AppUserTourState> existing =
        tourStateRepository.findByUser_IdAndTourKey(userId, tourKey);
    if (existing.isPresent()) {
      return; // idempotent: already marked
    }
    AppUser user =
        appUserRepository
            .findById(userId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "USER_NOT_FOUND"));
    AppUserTourState state = new AppUserTourState();
    state.setUser(user);
    state.setTourKey(tourKey);
    state.setSeenAt(Instant.now());
    tourStateRepository.save(state);
  }
}
