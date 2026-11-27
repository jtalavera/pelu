package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.PlatformAlert;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface PlatformAlertRepository extends JpaRepository<PlatformAlert, Long> {

  List<PlatformAlert> findByAcknowledgedAtIsNullOrderByCreatedAtDesc();

  Optional<PlatformAlert> findFirstByCategoryAndSubjectAndAcknowledgedAtIsNull(
      String category, String subject);
}
