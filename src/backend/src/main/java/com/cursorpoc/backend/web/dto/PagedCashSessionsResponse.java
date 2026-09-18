package com.cursorpoc.backend.web.dto;

import java.util.List;

public record PagedCashSessionsResponse(
    List<CashSessionListItemResponse> content,
    int page,
    int size,
    long totalElements,
    int totalPages) {}
