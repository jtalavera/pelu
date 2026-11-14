package com.cursorpoc.backend.config;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.MapPropertySource;

class FrontendUrlTest {

  @Configuration
  static class Holder {
    @Value(FrontendUrl.PRIMARY_EXPR)
    String url;
  }

  private static String resolve(Map<String, Object> props) {
    try (var ctx = new AnnotationConfigApplicationContext()) {
      ctx.getEnvironment().getPropertySources().addFirst(new MapPropertySource("t", props));
      ctx.register(Holder.class);
      ctx.refresh();
      return ctx.getBean(Holder.class).url;
    }
  }

  @Test
  void usesPrimaryUrlWhenSet() {
    assertEquals(
        "https://demo.flowbit.tech",
        resolve(
            Map.of(
                "app.frontend.url", "https://swa.azurestaticapps.net,https://demo.flowbit.tech",
                "app.frontend.primary-url", " https://demo.flowbit.tech ")));
  }

  @Test
  void fallsBackToFirstOriginWhenPrimaryUnsetOrBlank() {
    assertEquals(
        "https://a.example.com",
        resolve(Map.of("app.frontend.url", "https://a.example.com, https://b.example.com")));
    assertEquals(
        "https://a.example.com",
        resolve(
            Map.of(
                "app.frontend.url", "https://a.example.com,https://b.example.com",
                "app.frontend.primary-url", "")));
  }

  @Test
  void singleOriginIsUnchanged() {
    assertEquals(
        "http://localhost:5173", resolve(Map.of("app.frontend.url", "http://localhost:5173")));
  }
}
