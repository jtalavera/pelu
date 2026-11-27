package com.cursorpoc.backend.whatsapp;

import com.cursorpoc.backend.domain.PlatformAlert;
import com.cursorpoc.backend.repository.PlatformAlertRepository;
import java.time.Instant;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Minimal alerting for platform administrators (HU-WAP-02, criterio 3). Every alert is also logged
 * at ERROR. An open alert with the same category and subject is not duplicated. Email to platform
 * admins is HU-WAP-08.
 */
@Service
public class PlatformAlertService {

  private static final Logger log = LoggerFactory.getLogger(PlatformAlertService.class);

  private final PlatformAlertRepository repository;

  public PlatformAlertService(PlatformAlertRepository repository) {
    this.repository = repository;
  }

  @Transactional
  public void raise(String category, String subject, String detail) {
    log.error("PLATFORM ALERT category={} subject={} detail={}", category, subject, detail);
    if (repository
        .findFirstByCategoryAndSubjectAndAcknowledgedAtIsNull(category, subject)
        .isPresent()) {
      return;
    }
    PlatformAlert alert = new PlatformAlert();
    alert.setCategory(category);
    alert.setSubject(subject);
    alert.setDetail(detail == null ? null : detail.substring(0, Math.min(detail.length(), 500)));
    alert.setCreatedAt(Instant.now());
    repository.save(alert);
  }

  /** Closes the open alerts of a category and subject (the condition went away). */
  @Transactional
  public void resolveAll(String categoryPrefix, String subject) {
    for (PlatformAlert a : repository.findByAcknowledgedAtIsNullOrderByCreatedAtDesc()) {
      if (a.getCategory().startsWith(categoryPrefix) && a.getSubject().equals(subject)) {
        a.setAcknowledgedAt(Instant.now());
      }
    }
  }

  @Transactional(readOnly = true)
  public List<PlatformAlert> listOpen() {
    return repository.findByAcknowledgedAtIsNullOrderByCreatedAtDesc();
  }

  @Transactional
  public void acknowledge(long id) {
    PlatformAlert a =
        repository
            .findById(id)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "ALERT_NOT_FOUND"));
    if (a.getAcknowledgedAt() == null) {
      a.setAcknowledgedAt(Instant.now());
    }
  }
}
