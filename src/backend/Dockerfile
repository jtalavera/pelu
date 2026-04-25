# syntax=docker/dockerfile:1
# Expects a pre-built fat JAR (run ./gradlew bootJar before docker build; CI does this on the runner).
FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY build/libs/*.jar app.jar
USER app
EXPOSE 8080
# 0.5Gi container SKUs: cap heap so the process does not OOM before Spring is ready.
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75.0 -XX:InitialRAMPercentage=50.0 -XX:+ExitOnOutOfMemoryError"
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
