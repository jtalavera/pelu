package db.migration;

import com.cursorpoc.backend.commission.CommissionRulesConversion;
import org.flywaydb.core.api.migration.BaseJavaMigration;
import org.flywaydb.core.api.migration.Context;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * HU-COM-20: moves the existing commission rules to the simpler model (the retention for aguinaldo
 * belongs to the professional, and a professional's % is per service). The work is in {@link
 * CommissionRulesConversion}, which is tested on its own.
 */
public class V101__commission_simple_rules extends BaseJavaMigration {

  private static final Logger log = LoggerFactory.getLogger(V101__commission_simple_rules.class);

  @Override
  public void migrate(Context context) throws Exception {
    CommissionRulesConversion.Result result =
        CommissionRulesConversion.convert(context.getConnection());
    log.info(
        "V101 commission rules converted: foldedValues={} professionalsWithNewRetention={}"
            + " expandedRules={} retiredGroupRules={}",
        result.foldedValues(),
        result.professionalsWithNewRetention(),
        result.expandedRules(),
        result.retiredGroupRules());
  }
}
