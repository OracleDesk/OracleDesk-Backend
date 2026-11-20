-- Admin outbox console permissions (#221).
-- Data-only and forward-only. ensureAdminRbacSeeded() only seeds the RBAC
-- catalogue on an empty database, so permissions added to ADMIN_PERMISSIONS
-- later must reach already-seeded databases through a migration.
-- On a fresh database admin_roles is still empty here: the role grants below
-- insert nothing and the boot seed assigns them from ROLE_PERMISSIONS instead.
SET lock_timeout = '5s';

INSERT INTO "admin_permissions" ("key", "description")
VALUES
  ('chain.outbox.read', 'chain.outbox.read'),
  ('chain.outbox.operate', 'chain.outbox.operate')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "admin_role_permissions" ("roleName", "permissionKey")
SELECT r."name", p."key"
FROM "admin_roles" r
JOIN (VALUES
  ('super_admin', 'chain.outbox.read'),
  ('super_admin', 'chain.outbox.operate'),
  ('operator', 'chain.outbox.read'),
  ('operator', 'chain.outbox.operate'),
  ('auditor', 'chain.outbox.read')
) AS g ("roleName", "permissionKey") ON g."roleName" = r."name"
JOIN "admin_permissions" p ON p."key" = g."permissionKey"
ON CONFLICT ("roleName", "permissionKey") DO NOTHING;
