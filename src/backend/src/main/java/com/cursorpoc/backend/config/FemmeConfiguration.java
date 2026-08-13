package com.cursorpoc.backend.config;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

@Configuration
@EnableConfigurationProperties({
  FemmeJwtProperties.class,
  FemmeTimeProperties.class,
  FemmeSystemAdminProperties.class,
  SifenConnectionProperties.class,
  SifenQrProperties.class
})
public class FemmeConfiguration {}
