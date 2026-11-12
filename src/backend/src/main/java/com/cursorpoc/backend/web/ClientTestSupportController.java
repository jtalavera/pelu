package com.cursorpoc.backend.web;

import com.cursorpoc.backend.domain.Client;
import com.cursorpoc.backend.repository.ClientRepository;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Test-only support endpoint, gated behind {@code femme.data-init.enabled} like {@link
 * ServiceRecordTestSupportController} (true only for the {@code e2e} Spring profile). Never
 * reachable in production.
 *
 * <p>"Nuevos este mes": a client's {@code createdAt} is stamped with the real clock on insert, so
 * Playwright cannot seed a client registered last month through the real API alone. This shifts an
 * existing client's {@code createdAt} into the past. The lookup is tenant-scoped.
 */
@RestController
@RequestMapping("/api/admin/client-test-support")
@ConditionalOnProperty(name = "femme.data-init.enabled", havingValue = "true")
public class ClientTestSupportController {

  private static final Logger log = LoggerFactory.getLogger(ClientTestSupportController.class);

  private final ClientRepository clientRepository;

  public ClientTestSupportController(ClientRepository clientRepository) {
    this.clientRepository = clientRepository;
  }

  @PostMapping("/{id}/backdate-created/{daysAgo}")
  @Transactional
  public void backdateCreated(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @PathVariable long id,
      @PathVariable long daysAgo) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    long tenantId = principal.getTenantId();
    log.info(
        "POST /api/admin/client-test-support/{}/backdate-created/{} tenantId={}",
        id,
        daysAgo,
        tenantId);
    Client client =
        clientRepository
            .findByIdAndTenant_Id(id, tenantId)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "CLIENT_NOT_FOUND"));
    client.setCreatedAt(Instant.now().minus(daysAgo, ChronoUnit.DAYS));
    clientRepository.save(client);
    log.info(
        "POST /api/admin/client-test-support/{}/backdate-created/{} tenantId={} status=200",
        id,
        daysAgo,
        tenantId);
  }
}
