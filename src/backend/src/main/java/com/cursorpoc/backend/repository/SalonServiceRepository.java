package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.SalonService;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SalonServiceRepository extends JpaRepository<SalonService, Long> {

  List<SalonService> findByTenant_IdOrderByNameAsc(Long tenantId);

  Optional<SalonService> findByIdAndTenant_Id(Long id, Long tenantId);
}
