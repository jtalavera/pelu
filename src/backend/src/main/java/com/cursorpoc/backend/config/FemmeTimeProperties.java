package com.cursorpoc.backend.config;

import java.time.ZoneId;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "app.femme")
public class FemmeTimeProperties {

  /** IANA zone id used for business-day calculations (e.g. America/Asuncion). */
  private String businessZoneId = "America/Asuncion";

  public ZoneId zoneId() {
    return ZoneId.of(businessZoneId);
  }

  public String getBusinessZoneId() {
    return businessZoneId;
  }

  public void setBusinessZoneId(String businessZoneId) {
    this.businessZoneId = businessZoneId;
  }
}
