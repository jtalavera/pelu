package com.cursorpoc.backend.config;

import static org.assertj.core.api.Assertions.assertThat;

import com.cursorpoc.backend.config.SifenConnectionProperties.Environment;
import org.junit.jupiter.api.Test;

class SifenConnectionPropertiesTest {

  @Test
  void activeBaseUrl_returnsTestUrl_whenEnvironmentIsTest() {
    SifenConnectionProperties props = new SifenConnectionProperties();
    props.setEnvironment(Environment.TEST);
    props.setTestBaseUrl("https://sifen-test.set.gov.py");
    props.setProductionBaseUrl("https://sifen.set.gov.py");

    assertThat(props.activeEnvironment()).isEqualTo(Environment.TEST);
    assertThat(props.activeBaseUrl()).isEqualTo("https://sifen-test.set.gov.py");
  }

  @Test
  void activeBaseUrl_switchesToProduction_byConfigurationOnly() {
    // HU-05 AC-04: switching environments must never require a code change.
    SifenConnectionProperties props = new SifenConnectionProperties();
    props.setEnvironment(Environment.PRODUCTION);
    props.setTestBaseUrl("https://sifen-test.set.gov.py");
    props.setProductionBaseUrl("https://sifen.set.gov.py");

    assertThat(props.activeEnvironment()).isEqualTo(Environment.PRODUCTION);
    assertThat(props.activeBaseUrl()).isEqualTo("https://sifen.set.gov.py");
  }
}
