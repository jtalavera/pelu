package com.cursorpoc.backend.web.dto;

public record BusinessProfileResponse(
    String businessName,
    String ruc,
    String address,
    String phone,
    String contactEmail,
    String logoDataUrl) {}
