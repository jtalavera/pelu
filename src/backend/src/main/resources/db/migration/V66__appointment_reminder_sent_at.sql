-- Issue #218: tracks when the ~24h-ahead reminder email was sent for an appointment's *current*
-- startAt slot. Null means "not sent yet for this slot" -- AppointmentService#update resets it to
-- NULL whenever startAt actually changes, so a reschedule always gets a fresh reminder.
ALTER TABLE appointments ADD reminder_sent_at DATETIME2 NULL;
