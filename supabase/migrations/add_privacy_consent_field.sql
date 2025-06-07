-- Migration: Add privacy_consent_given field to trial_blocks table
-- This field tracks whether the user has given consent for data collection via PostHog

-- Add privacy_consent_given column to test.trial_blocks
ALTER TABLE test.trial_blocks 
ADD COLUMN privacy_consent_given BOOLEAN DEFAULT FALSE;

-- Add privacy_consent_given column to prod.trial_blocks  
ALTER TABLE prod.trial_blocks 
ADD COLUMN privacy_consent_given BOOLEAN DEFAULT FALSE;

-- Add index for faster queries on consent status
CREATE INDEX idx_test_trial_blocks_consent ON test.trial_blocks(privacy_consent_given);
CREATE INDEX idx_prod_trial_blocks_consent ON prod.trial_blocks(privacy_consent_given);

-- Update existing records to have consent as false by default (explicit consent required)
UPDATE test.trial_blocks SET privacy_consent_given = FALSE WHERE privacy_consent_given IS NULL;
UPDATE prod.trial_blocks SET privacy_consent_given = FALSE WHERE privacy_consent_given IS NULL; 