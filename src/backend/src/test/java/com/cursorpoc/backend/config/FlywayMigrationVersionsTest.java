package com.cursorpoc.backend.config;

import static org.assertj.core.api.Assertions.assertThatCode;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;

/**
 * Tests run with Flyway disabled (JPA create-drop on H2), so a duplicated migration version (e.g. a
 * SQL and a Java migration both numbered V101, merged from two branches) is invisible to CI and
 * only crashes the app at boot in the deployed environment. This runs Flyway's own migration
 * resolver over the real locations (SQL under {@code db/migration} plus Java migrations in package
 * {@code db.migration}) without executing anything, so it fails with the same "Found more than one
 * migration with version N" error.
 */
class FlywayMigrationVersionsTest {

  @Test
  void migrationVersionsAreUnique() {
    Flyway flyway =
        Flyway.configure()
            .dataSource("jdbc:h2:mem:flyway_versions_check;DB_CLOSE_DELAY=-1", "sa", "")
            .locations("classpath:db/migration")
            .load();

    assertThatCode(() -> flyway.info().all()).doesNotThrowAnyException();
  }
}
