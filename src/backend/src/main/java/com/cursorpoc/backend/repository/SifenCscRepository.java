package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.SifenCsc;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SifenCscRepository extends JpaRepository<SifenCsc, Long> {

  List<SifenCsc> findByTenant_IdOrderByIdCscAsc(Long tenantId);

  Optional<SifenCsc> findByTenant_IdAndIdCsc(Long tenantId, int idCsc);

  Optional<SifenCsc> findByTenant_IdAndActiveTrue(Long tenantId);

  long deleteByTenant_Id(Long tenantId);
}
