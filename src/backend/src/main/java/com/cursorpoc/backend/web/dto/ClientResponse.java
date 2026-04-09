package com.cursorpoc.backend.web.dto;

public record ClientResponse(
    long id,
    String fullName,
    String phone,
    String email,
    String ruc,
    boolean active,
    int visitCount) {}
