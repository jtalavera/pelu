# syntax=docker/dockerfile:1
# Expects a pre-built fat JAR (run ./gradlew bootJar before docker build; CI does this on the runner).
FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
# Issue #268: Application Insights Java agent (Microsoft's OpenTelemetry distro) — auto-instruments
# Spring MVC, JDBC, outbound HTTP (SIFEN) and the Service Bus SDK, and exports traces, logs and the
# app's custom OpenTelemetry metrics to the App Insights resource named by the
# APPLICATIONINSIGHTS_CONNECTION_STRING env var (set by Terraform on the Container App). Its
# config (role name, sampling, log level) is applicationinsights.json, read from the jar's own
# directory. Bump the version and checksum together.
ADD --checksum=sha256:93a70c8f5d364c7e777f6c4d1b235dba91aef8448bd3fa94359f1d7f3e2eb0ec --chmod=644 \
    https://github.com/microsoft/ApplicationInsights-Java/releases/download/3.7.10/applicationinsights-agent-3.7.10.jar \
    /app/applicationinsights-agent.jar
COPY applicationinsights.json /app/applicationinsights.json
COPY build/libs/*.jar app.jar
USER app
EXPOSE 8080
# 0.5Gi container SKUs: cap heap so the process does not OOM before Spring is ready.
ENV JAVA_TOOL_OPTIONS="-javaagent:/app/applicationinsights-agent.jar -XX:MaxRAMPercentage=75.0 -XX:InitialRAMPercentage=50.0 -XX:+ExitOnOutOfMemoryError"
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
