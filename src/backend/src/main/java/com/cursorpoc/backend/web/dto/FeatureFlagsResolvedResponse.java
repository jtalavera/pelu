package com.cursorpoc.backend.web.dto;

import java.util.Map;

public record FeatureFlagsResolvedResponse(Map<String, Boolean> flags) {}
