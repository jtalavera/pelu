package com.cursorpoc.backend.config;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.springframework.beans.factory.config.BeanFactoryPostProcessor;
import org.springframework.beans.factory.config.ConfigurableListableBeanFactory;
import org.springframework.beans.factory.support.AbstractBeanDefinition;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Ensures Flyway migrations run before Hibernate validates the schema ({@code
 * spring.jpa.hibernate.ddl-auto=validate}). Without this ordering, startup can fail with {@code
 * Schema validation: missing table [...]} even when migrations would create them.
 */
@Configuration
public class FlywayBeforeJpaConfig {

  private static final String ENTITY_MANAGER_FACTORY = "entityManagerFactory";

  /** Spring Boot registers this bean from {@code FlywayAutoConfiguration}. */
  private static final String FLYWAY_INITIALIZER = "flywayInitializer";

  @Bean
  public static BeanFactoryPostProcessor entityManagerFactoryDependsOnFlyway() {
    return beanFactory -> {
      if (!(beanFactory instanceof ConfigurableListableBeanFactory configurable)) {
        return;
      }
      if (!configurable.containsBeanDefinition(ENTITY_MANAGER_FACTORY)
          || !configurable.containsBeanDefinition(FLYWAY_INITIALIZER)) {
        return;
      }
      AbstractBeanDefinition emf =
          (AbstractBeanDefinition) configurable.getBeanDefinition(ENTITY_MANAGER_FACTORY);
      String[] current = emf.getDependsOn();
      if (current == null || current.length == 0) {
        emf.setDependsOn(FLYWAY_INITIALIZER);
      } else if (Arrays.stream(current).noneMatch(FLYWAY_INITIALIZER::equals)) {
        List<String> merged = new ArrayList<>(Arrays.asList(current));
        merged.add(FLYWAY_INITIALIZER);
        emf.setDependsOn(merged.toArray(String[]::new));
      }
    };
  }
}
