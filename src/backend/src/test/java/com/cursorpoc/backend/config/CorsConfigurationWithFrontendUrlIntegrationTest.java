package com.cursorpoc.backend.config;

import static org.assertj.core.api.Assertions.assertThat;

import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;

@SpringBootTest
@ActiveProfiles("test")
@TestPropertySource(properties = "app.frontend.url=https://deployed-frontend.example.com")
class CorsConfigurationWithFrontendUrlIntegrationTest {

  @Autowired private CorsConfigurationSource corsConfigurationSource;

  @Test
  void includesAppFrontendUrlAlongsideLocalDevOrigins() {
    HttpServletRequest request = new MockHttpServletRequest();
    CorsConfiguration cors = corsConfigurationSource.getCorsConfiguration(request);
    assertThat(cors).isNotNull();
    assertThat(cors.getAllowedOriginPatterns())
        .containsExactlyInAnyOrder(
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "https://deployed-frontend.example.com");
  }
}
