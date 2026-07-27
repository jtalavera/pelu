package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.SifenCertificate;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SifenCertificateRepository extends JpaRepository<SifenCertificate, Long> {

  List<SifenCertificate> findByTenant_IdOrderByUploadedAtDesc(Long tenantId);
}
