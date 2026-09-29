-- Administrators manage the organisation's resources, no longer every
-- resource: update the built-in description unless it was edited.
UPDATE "groups"
SET "description" = 'Members are MetaMCP administrators: they manage users, groups, settings and the organisation''s resources.'
WHERE "system_key" = 'admins'
  AND "description" = 'Members are MetaMCP administrators: they manage users, groups, settings and every resource.';
