-- Issue #225: tracks when the ~24h-ahead reminder WhatsApp message was sent for an appointment's
-- *current* startAt slot -- a separate flag from V66's reminder_sent_at (email) because the two
-- channels are independent: a client can have email only, phone only, both, or neither, and each
-- channel's send/failure must not affect the other. Null means "not sent yet for this slot" --
-- AppointmentService#update resets it to NULL whenever startAt actually changes, same as
-- reminder_sent_at, so a reschedule always gets a fresh reminder on both channels.
ALTER TABLE appointments ADD whatsapp_reminder_sent_at DATETIME2 NULL;
