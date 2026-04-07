package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.ProfessionalSchedule;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ProfessionalScheduleRepository extends JpaRepository<ProfessionalSchedule, Long> {

  List<ProfessionalSchedule> findByProfessionalIdOrderByDayOfWeekAscIdAsc(Long professionalId);

  void deleteByProfessionalId(Long professionalId);
}
