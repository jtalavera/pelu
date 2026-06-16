package com.cursorpoc.backend.web.dto;

import java.time.Instant;

public record TourStateResponse(String tourKey, Instant seenAt) {}
