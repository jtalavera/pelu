plugins {
    java
    id("org.springframework.boot") version "4.0.4"
    id("io.spring.dependency-management") version "1.1.7"
    id("com.diffplug.spotless") version "6.25.0"
}

group = "com.cursorpoc"
version = "0.0.1-SNAPSHOT"

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(21)
    }
}

repositories {
    mavenCentral()
}

dependencies {
    developmentOnly("org.springframework.boot:spring-boot-devtools")
    implementation("org.springframework.boot:spring-boot-starter-web")
    implementation("org.springframework.boot:spring-boot-starter-security")
    implementation("org.springframework.boot:spring-boot-starter-data-jpa")
    implementation("org.springframework.boot:spring-boot-starter-validation")
    implementation("org.springframework.boot:spring-boot-starter-flyway")
    implementation("org.flywaydb:flyway-sqlserver")
    implementation("com.microsoft.sqlserver:mssql-jdbc")
    implementation("com.microsoft.azure:msal4j:1.17.2")
    implementation("com.azure:azure-identity:1.15.4")
    // RT-12/RT-18 (Hardening_SIFEN.md): per-tenant SIFEN certificate secrets + the app JWT secret
    // live in Azure Key Vault outside the e2e profile, resolved via the DefaultAzureCredential
    // (Managed Identity) already pulled in by azure-identity above.
    implementation("com.azure:azure-security-keyvault-secrets:4.10.4")
    // RT-20 (Hardening_SIFEN.md): asynchronous SIFEN transmission via Azure Service Bus (Basic
    // tier) — see SifenSubmissionQueueListener/ServiceBusSifenSubmissionQueue.
    implementation("com.azure:azure-messaging-servicebus:7.17.19")
    implementation("org.springframework.boot:spring-boot-starter-actuator")
    // RT-21: per-operation SIFEN metrics exported to the Application Insights resource Terraform
    // already provisions (APPLICATIONINSIGHTS_CONNECTION_STRING) — see SifenCallMetrics.
    implementation("io.micrometer:micrometer-registry-azure-monitor:1.17.0")
    implementation("org.springdoc:springdoc-openapi-starter-webmvc-ui:3.0.2")
    implementation("io.jsonwebtoken:jjwt-api:0.12.6")
    runtimeOnly("io.jsonwebtoken:jjwt-impl:0.12.6")
    runtimeOnly("io.jsonwebtoken:jjwt-jackson:0.12.6")
    implementation("com.github.librepdf:openpdf:1.3.30")
    implementation("com.azure:azure-communication-email:1.0.16")
    // SIFEN HU-08: QR code generation for the KuDE (AC-13). No QR library existed in this repo
    // before; zxing:core alone is enough (no javase/awt-integration submodule needed — the raster
    // is built by hand from its BitMatrix, see SifenQrImageService).
    implementation("com.google.zxing:core:3.5.3")
    // Issue #174 AC-05: .xlsx export of the invoice-history report (header data only).
    implementation("org.apache.poi:poi-ooxml:5.3.0")

    runtimeOnly("com.h2database:h2")
    testImplementation("org.springframework.boot:spring-boot-starter-test")
}

tasks.withType<Test> {
    useJUnitPlatform()
}

spotless {
    java {
        target("src/**/*.java")
        googleJavaFormat("1.23.0")
    }
}
