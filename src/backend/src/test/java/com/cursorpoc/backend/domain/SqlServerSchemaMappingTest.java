package com.cursorpoc.backend.domain;

import static org.assertj.core.api.Assertions.assertThat;

import jakarta.persistence.Entity;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.hibernate.boot.Metadata;
import org.hibernate.boot.MetadataSources;
import org.hibernate.boot.registry.StandardServiceRegistry;
import org.hibernate.boot.registry.StandardServiceRegistryBuilder;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.config.BeanDefinition;
import org.springframework.context.annotation.ClassPathScanningCandidateComponentProvider;
import org.springframework.core.type.filter.AnnotationTypeFilter;

/**
 * Production runs {@code spring.jpa.hibernate.ddl-auto=validate} on SQL Server, but every test runs
 * on H2 with {@code create-drop}, which never validates the schema. So an entity whose mapping does
 * not match its Flyway migration passes CI and then keeps the app from booting in Azure (the
 * container never listens on :8080 and the deploy fails).
 *
 * <p>The classic case: Hibernate 7 maps a plain {@link java.time.Instant} to {@code DATETIMEOFFSET}
 * on SQL Server, while this project's migrations create {@code DATETIME2}. Every {@code Instant}
 * field must therefore carry {@code @JdbcTypeCode(SqlTypes.TIMESTAMP)} (see V12 for the one column
 * that went the other way). This test asks Hibernate for the DDL it would generate for SQL Server
 * (no connection needed) and fails if any column other than the known one is {@code
 * datetimeoffset}.
 */
class SqlServerSchemaMappingTest {

  /** Tables whose Instant columns are DATETIMEOFFSET in the real schema (V12). */
  private static final List<String> DATETIMEOFFSET_TABLES = List.of("app_user_tour_state");

  private static String sqlServerDdl() throws Exception {
    Path script = Files.createTempFile("sqlserver-schema", ".sql");
    StandardServiceRegistry registry =
        new StandardServiceRegistryBuilder()
            .applySetting("hibernate.dialect", "org.hibernate.dialect.SQLServerDialect")
            .applySetting("hibernate.boot.allow_jdbc_metadata_access", "false")
            // Standard JPA script generation: writes the CREATE statements, touches no database.
            .applySetting("jakarta.persistence.schema-generation.scripts.action", "create")
            .applySetting(
                "jakarta.persistence.schema-generation.scripts.create-target", script.toString())
            .build();
    try {
      MetadataSources sources = new MetadataSources(registry);
      ClassPathScanningCandidateComponentProvider scanner =
          new ClassPathScanningCandidateComponentProvider(false);
      scanner.addIncludeFilter(new AnnotationTypeFilter(Entity.class));
      for (BeanDefinition bd : scanner.findCandidateComponents("com.cursorpoc.backend")) {
        sources.addAnnotatedClass(Class.forName(bd.getBeanClassName()));
      }
      Metadata metadata = sources.buildMetadata();
      metadata.buildSessionFactory().close();
      return Files.readString(script);
    } finally {
      StandardServiceRegistryBuilder.destroy(registry);
      Files.deleteIfExists(script);
    }
  }

  /** {@code create table <name> (...)} statements keyed by table name. */
  private static List<String[]> tables(String ddl) {
    List<String[]> out = new ArrayList<>();
    Matcher m =
        Pattern.compile("create table (\\w+) \\((.*?)\\)\\s*;", Pattern.DOTALL).matcher(ddl);
    while (m.find()) {
      out.add(new String[] {m.group(1), m.group(2)});
    }
    return out;
  }

  @Test
  void noInstantIsMappedToDatetimeoffset_exceptTheKnownColumn() throws Exception {
    String ddl = sqlServerDdl();
    List<String> offenders = new ArrayList<>();
    for (String[] t : tables(ddl)) {
      if (t[1].contains("datetimeoffset") && !DATETIMEOFFSET_TABLES.contains(t[0])) {
        for (String column : t[1].split(",\\s*(?=\\w+ )")) {
          if (column.contains("datetimeoffset")) {
            offenders.add(t[0] + "." + column.trim().split(" ")[0]);
          }
        }
      }
    }
    assertThat(offenders)
        .as(
            "Instant columns Hibernate would validate as DATETIMEOFFSET on SQL Server but whose"
                + " migrations create DATETIME2: annotate the field with"
                + " @JdbcTypeCode(SqlTypes.TIMESTAMP)")
        .isEmpty();
  }

  @Test
  void theWhatsAppTablesUseDatetime2() throws Exception {
    List<String[]> tables = tables(sqlServerDdl());
    for (String name :
        List.of(
            "whatsapp_messages",
            "whatsapp_template_status",
            "whatsapp_opt_outs",
            "whatsapp_unreachable",
            "whatsapp_processed_events",
            "platform_alerts")) {
      String body =
          tables.stream().filter(t -> t[0].equals(name)).map(t -> t[1]).findFirst().orElse(null);
      assertThat(body).as("table " + name + " is mapped").isNotNull();
      assertThat(body).as(name).contains("datetime2").doesNotContain("datetimeoffset");
    }
  }

  @Test
  void theKnownDatetimeoffsetExceptionIsStillTheOnlyOne() throws Exception {
    List<String[]> tables = tables(sqlServerDdl());
    String body =
        tables.stream()
            .filter(t -> t[0].equals("app_user_tour_state"))
            .map(t -> t[1])
            .findFirst()
            .orElse("");
    assertThat(body).contains("datetimeoffset");
  }
}
