-- HU-30 AC-10: add address field to professionals for user profile editing
ALTER TABLE professionals ADD address NVARCHAR(255) NULL;
