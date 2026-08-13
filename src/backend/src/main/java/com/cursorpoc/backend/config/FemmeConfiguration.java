package com.cursorpoc.backend.config;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * RT-20 (Hardening_SIFEN.md): {@code @EnableScheduling} is new here — {@code
 * SifenSubmissionReconciler} is the first {@code @Scheduled} job in this codebase. It's pure DB
 * polling (no Service Bus dependency), so it runs regardless of scale-to-zero/wake-schedule
 * behavior; it simply does nothing while the Container App itself is scaled to zero, same as any
 * other in-process code would.
 */
@Configuration
@EnableConfigurationProperties({
  FemmeJwtProperties.class,
  FemmeTimeProperties.class,
  FemmeSystemAdminProperties.class,
  SifenConnectionProperties.class,
  SifenQrProperties.class
})
@EnableScheduling
public class FemmeConfiguration {}
