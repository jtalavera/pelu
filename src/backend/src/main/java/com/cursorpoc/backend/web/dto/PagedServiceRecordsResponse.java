package com.cursorpoc.backend.web.dto;

import java.util.List;

public record PagedServiceRecordsResponse(
    List<ServiceRecordListItemResponse> content,
    int page,
    int size,
    long totalElements,
    int totalPages) {}
