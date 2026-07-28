package com.cursorpoc.backend.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * HU-05 AC-04: switching between SIFEN's test and production environments is configuration-only,
 * never a code change. Base URLs default to the real addresses published in the technical manual
 * (Manual Tecnico V150.pdf, section 7.10) — verified live: {@code testBaseUrl} genuinely enforces
 * mutual TLS (confirmed against sifen-test.set.gov.py).
 */
@ConfigurationProperties(prefix = "app.femme.sifen.connection")
public class SifenConnectionProperties {

  public enum Environment {
    TEST,
    PRODUCTION
  }

  private Environment environment = Environment.TEST;
  private String testBaseUrl = "https://sifen-test.set.gov.py";
  private String productionBaseUrl = "https://sifen.set.gov.py";

  public Environment activeEnvironment() {
    return environment;
  }

  public String activeBaseUrl() {
    return environment == Environment.PRODUCTION ? productionBaseUrl : testBaseUrl;
  }

  public Environment getEnvironment() {
    return environment;
  }

  public void setEnvironment(Environment environment) {
    this.environment = environment;
  }

  public String getTestBaseUrl() {
    return testBaseUrl;
  }

  public void setTestBaseUrl(String testBaseUrl) {
    this.testBaseUrl = testBaseUrl;
  }

  public String getProductionBaseUrl() {
    return productionBaseUrl;
  }

  public void setProductionBaseUrl(String productionBaseUrl) {
    this.productionBaseUrl = productionBaseUrl;
  }
}
