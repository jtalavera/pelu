package com.cursorpoc.backend.assistant;

import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class AssistantConfig {

  /**
   * Worker threads that run the (blocking) model/tool loop behind the SSE responses. Bounded on
   * purpose: when full, a new message is refused ({@code 503 ASSISTANT_MODEL_UNAVAILABLE}) instead
   * of piling up model calls — the container is small.
   */
  @Bean(destroyMethod = "shutdown")
  ExecutorService assistantExecutor() {
    AtomicInteger n = new AtomicInteger();
    ThreadFactory threads =
        r -> {
          Thread t = new Thread(r, "assistant-" + n.incrementAndGet());
          t.setDaemon(true);
          return t;
        };
    return new ThreadPoolExecutor(
        2, 8, 60, TimeUnit.SECONDS, new ArrayBlockingQueue<>(16), threads);
  }
}
