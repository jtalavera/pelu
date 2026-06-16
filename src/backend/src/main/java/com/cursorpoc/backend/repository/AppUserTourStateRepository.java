package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.AppUserTourState;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AppUserTourStateRepository extends JpaRepository<AppUserTourState, Long> {

  List<AppUserTourState> findByUser_Id(Long userId);

  Optional<AppUserTourState> findByUser_IdAndTourKey(Long userId, String tourKey);
}
