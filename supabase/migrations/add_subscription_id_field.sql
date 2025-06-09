-- Migration: Add stripe_subscription_id field to licenses table
-- This field tracks the Stripe subscription ID for annual subscriptions

-- Add stripe_subscription_id column to test.licenses
ALTER TABLE test.licenses 
ADD COLUMN stripe_subscription_id TEXT;

-- Add stripe_subscription_id column to prod.licenses  
ALTER TABLE prod.licenses 
ADD COLUMN stripe_subscription_id TEXT;

-- Add index for faster queries on subscription ID
CREATE INDEX idx_test_licenses_subscription_id ON test.licenses(stripe_subscription_id);
CREATE INDEX idx_prod_licenses_subscription_id ON prod.licenses(stripe_subscription_id);

-- Add comment to explain the field
COMMENT ON COLUMN test.licenses.stripe_subscription_id IS 'Stripe subscription ID for annual recurring licenses';
COMMENT ON COLUMN prod.licenses.stripe_subscription_id IS 'Stripe subscription ID for annual recurring licenses'; 