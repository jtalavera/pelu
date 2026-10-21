package com.cursorpoc.backend.web.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

/**
 * HU-67: read-only summary shown on top of the client profile. Built only from CLOSED service
 * records (OPEN and VOIDED ones never count).
 */
public record ClientSummaryResponse(
    List<UsualProfessional> usualProfessionals,
    Instant lastVisitAt,
    BigDecimal spentLast12Months,
    BigDecimal averageTicketLast12Months,
    List<ServiceItem> lastServices,
    List<ProductItem> lastProducts) {

  public record UsualProfessional(long id, String fullName, boolean active, int serviceCount) {}

  public record ServiceItem(
      Instant performedAt,
      String serviceName,
      Long professionalId,
      String professionalName,
      BigDecimal price) {}

  public record ProductItem(
      Instant purchasedAt, String productName, int quantity, BigDecimal unitPrice) {}
}
