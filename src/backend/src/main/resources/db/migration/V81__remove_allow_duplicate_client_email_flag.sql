-- Client email is no longer unique per tenant (several clients may share one email), so the
-- ALLOW_DUPLICATE_CLIENT_EMAIL flag (V51/V52) that lifted that check in the SIFEN TEST environment
-- has no reason to exist. Remove the flag and every override that references it; the *_changes
-- audit tables carry no foreign key and keep their history.
DELETE FROM tier_feature_flags WHERE flag_key = 'ALLOW_DUPLICATE_CLIENT_EMAIL';
DELETE FROM tenant_feature_flags WHERE flag_key = 'ALLOW_DUPLICATE_CLIENT_EMAIL';
DELETE FROM feature_flags WHERE flag_key = 'ALLOW_DUPLICATE_CLIENT_EMAIL';
