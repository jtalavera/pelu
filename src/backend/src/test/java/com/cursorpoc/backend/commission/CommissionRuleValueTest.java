package com.cursorpoc.backend.commission;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.cursorpoc.backend.commission.CommissionRuleValue.FixedDestination;
import java.math.BigDecimal;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

class CommissionRuleValueTest {

  @Test
  void aPlainPercentKeepsTheOriginalFormat() {
    CommissionRuleValue v = CommissionRuleValue.parse("45.00");
    assertThat(v.percent()).isEqualByComparingTo("45");
    assertThat(v.retentionPercent()).isEqualByComparingTo("0");
    assertThat(v.fixedAmount()).isEqualByComparingTo("0");
    assertThat(v.fixedDestination()).isNull();
    assertThat(v.serialize()).isEqualTo("45.00");
  }

  @Test
  void theRichFormatRoundTrips() {
    CommissionRuleValue v = CommissionRuleValue.parse("45|5|3000|P");
    assertThat(v.percent()).isEqualByComparingTo("45");
    assertThat(v.retentionPercent()).isEqualByComparingTo("5");
    assertThat(v.fixedAmount()).isEqualByComparingTo("3000");
    assertThat(v.fixedDestination()).isEqualTo(FixedDestination.PROFESSIONAL);
    assertThat(v.serialize()).isEqualTo("45.00|5.00|3000|P");
    assertThat(CommissionRuleValue.parse(v.serialize()).serialize()).isEqualTo(v.serialize());
  }

  @Test
  void anEmptyDestinationFollowsTheSalonDefault() {
    CommissionRuleValue v = CommissionRuleValue.parse("50|0|3000|");
    assertThat(v.fixedDestination()).isNull();
    assertThat(v.serialize()).isEqualTo("50.00|0.00|3000|");
    assertThat(CommissionRuleValue.parse("50|0|3000|S").fixedDestination())
        .isEqualTo(FixedDestination.SALON);
  }

  @Test
  void invalidValuesAreRejected() {
    assertThatThrownBy(() -> CommissionRuleValue.parse("abc")).isInstanceOf(RuntimeException.class);
    assertThatThrownBy(() -> CommissionRuleValue.parse("45|5|3000|X"))
        .isInstanceOf(RuntimeException.class);
    assertThatThrownBy(() -> CommissionRuleValue.parse("1|2|3|P|9"))
        .isInstanceOf(RuntimeException.class);
  }

  @Test
  void theServiceValidationRejectsOutOfRangeValues() {
    // HU-COM-20: the retention is not part of a rule any more: it is ignored when stored.
    assertThat(CommissionConfigService.parseRuleValue("45|5|3000|P"))
        .isEqualTo("45.00|0.00|3000|P");
    assertThat(CommissionConfigService.parseRuleValue("45")).isEqualTo("45.00");
    for (String bad : new String[] {"101", "45|0|-1|", "45|0|1.5|", "45|0|x|"}) {
      assertThatThrownBy(() -> CommissionConfigService.parseRuleValue(bad))
          .isInstanceOf(ResponseStatusException.class);
    }
    assertThat(new BigDecimal("0")).isNotNull();
  }
}
