-- AlterEnum
BEGIN;
CREATE TYPE "PermissionScope_new" AS ENUM ('ALL', 'TEAM', 'ASSIGNED', 'OWN');
ALTER TABLE "public"."RolePermission" ALTER COLUMN "scope" DROP DEFAULT;
ALTER TABLE "RolePermission" ALTER COLUMN "scope" TYPE "PermissionScope_new" USING ("scope"::text::"PermissionScope_new");
ALTER TYPE "PermissionScope" RENAME TO "PermissionScope_old";
ALTER TYPE "PermissionScope_new" RENAME TO "PermissionScope";
DROP TYPE "public"."PermissionScope_old";
ALTER TABLE "RolePermission" ALTER COLUMN "scope" SET DEFAULT 'OWN';
COMMIT;

