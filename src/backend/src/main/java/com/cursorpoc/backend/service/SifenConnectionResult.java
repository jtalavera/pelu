package com.cursorpoc.backend.service;

import com.cursorpoc.backend.config.SifenConnectionProperties.Environment;
import java.time.Instant;

/**
 * HU-05: evidence of a successful, authenticated connection to SIFEN. Later stories (HU-02 AC-08,
 * HU-06, EP-05) need {@code environment} to decide things like the "no commercial value" legend on
 * test-environment documents.
 */
public record SifenConnectionResult(Environment environment, Instant connectedAt) {}
