package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.CommissionConfigVersion;
import com.cursorpoc.backend.domain.enums.CommissionVersionStatus;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CommissionConfigVersionRepository
    extends JpaRepository<CommissionConfigVersion, Long> {

  List<CommissionConfigVersion> findByTenantIdAndStatus(
      long tenantId, CommissionVersionStatus status);

  List<CommissionConfigVersion> findByTenantIdOrderByCreatedAtDescIdDesc(long tenantId);
}
