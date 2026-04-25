# syntax=docker/dockerfile:1
# Expects a pre-built fat JAR (run ./gradlew bootJar before docker build; CI does this on the runner).
FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
RUN mkdir -p /var/log/pelu && chown -R app:app /var/log/pelu
COPY build/libs/*.jar app.jar
ENV JAVA_TOOL_OPTIONS="-Dlogging.file.name=/var/log/pelu/backend.log"
USER app
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
