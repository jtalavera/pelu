package com.cursorpoc.backend;

import java.util.TimeZone;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class BackendApplication {

  public static void main(String[] args) {
    // Issue #290: the server timezone is UTC (PRD). Hibernate binds/reads DATE columns with a UTC
    // calendar (hibernate.jdbc.time_zone=UTC) but turns the java.sql.Date into a LocalDate with the
    // JVM default zone — on a JVM west of UTC (e.g. a dev machine in America/Asuncion) every
    // LocalDate came back one day early, and saving it back persisted the shifted day. The prod
    // container already defaults to UTC; pinning it here makes every host behave the same.
    TimeZone.setDefault(TimeZone.getTimeZone("UTC"));
    SpringApplication.run(BackendApplication.class, args);
  }
}
