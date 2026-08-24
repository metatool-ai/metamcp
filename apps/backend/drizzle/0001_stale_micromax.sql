-- Custom SQL migration file, put your code below! --

-- Custom migration: Update config keys to uppercase format
-- Migrate existing config keys from lowercase to uppercase

UPDATE config 
SET id = 'DISABLE_SIGNUP', updated_at = NOW() 
WHERE id = 'disable_signup';

-- Add any future config key migrations here as needed
-- Example: UPDATE config SET id = 'EXAMPLE_KEY', updated_at = NOW() WHERE id = 'example_key';