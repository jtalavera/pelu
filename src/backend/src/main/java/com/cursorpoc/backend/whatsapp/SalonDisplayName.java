package com.cursorpoc.backend.whatsapp;

import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.repository.BusinessProfileRepository;
import org.springframework.stereotype.Component;

/**
 * The salon's name as the client reads it inside a WhatsApp message: the business name of its
 * profile, or the tenant's name when none is set. The shared number is Flowbit's, so every message
 * must name the salon in its text (decision D9).
 */
@Component
public class SalonDisplayName {

  private final BusinessProfileRepository businessProfiles;

  public SalonDisplayName(BusinessProfileRepository businessProfiles) {
    this.businessProfiles = businessProfiles;
  }

  public String of(long tenantId, Tenant tenant) {
    return businessProfiles
        .findByTenantId(tenantId)
        .map(p -> p.getBusinessName())
        .filter(n -> n != null && !n.isBlank())
        .orElseGet(tenant::getName);
  }
}
