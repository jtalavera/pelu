package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.WhatsAppAutoReply;
import org.springframework.data.jpa.repository.JpaRepository;

public interface WhatsAppAutoReplyRepository extends JpaRepository<WhatsAppAutoReply, String> {}
