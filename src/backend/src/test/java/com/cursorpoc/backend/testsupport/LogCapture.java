package com.cursorpoc.backend.testsupport;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import java.util.List;
import org.slf4j.LoggerFactory;

/**
 * Attaches a Logback {@link ListAppender} to a class's logger for the lifetime of a
 * try-with-resources block, so a test can assert on the exact formatted log lines a call produced
 * (e.g. the {@code [SIFEN req]}/{@code [SIFEN resp]} lines every SIFEN web-service call site
 * emits).
 */
public final class LogCapture implements AutoCloseable {

  private final Logger logbackLogger;
  private final ListAppender<ILoggingEvent> appender = new ListAppender<>();

  public LogCapture(Class<?> loggedClass) {
    logbackLogger = (Logger) LoggerFactory.getLogger(loggedClass);
    appender.start();
    logbackLogger.addAppender(appender);
  }

  public List<String> messages() {
    return appender.list.stream().map(ILoggingEvent::getFormattedMessage).toList();
  }

  @Override
  public void close() {
    logbackLogger.detachAppender(appender);
    appender.stop();
  }
}
