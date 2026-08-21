package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.TenantImportRunRow;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TenantImportRunRowRepository extends JpaRepository<TenantImportRunRow, Long> {

  List<TenantImportRunRow> findByImportRunIdOrderByRowNumberAsc(Long importRunId);

  void deleteByImportRunId(Long importRunId);
}
