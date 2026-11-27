package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.WhatsAppTemplateStatus;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface WhatsAppTemplateStatusRepository
    extends JpaRepository<WhatsAppTemplateStatus, Long> {

  Optional<WhatsAppTemplateStatus> findByTemplateNameAndLanguage(
      String templateName, String language);
}
