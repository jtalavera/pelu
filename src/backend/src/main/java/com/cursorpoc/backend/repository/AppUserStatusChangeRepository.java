package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.AppUserStatusChange;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AppUserStatusChangeRepository extends JpaRepository<AppUserStatusChange, Long> {

  Optional<AppUserStatusChange> findByAppUserId(Long appUserId);
}
