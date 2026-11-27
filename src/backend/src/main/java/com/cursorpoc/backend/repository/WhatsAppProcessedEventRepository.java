package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.WhatsAppProcessedEvent;
import org.springframework.data.jpa.repository.JpaRepository;

public interface WhatsAppProcessedEventRepository
    extends JpaRepository<WhatsAppProcessedEvent, String> {}
