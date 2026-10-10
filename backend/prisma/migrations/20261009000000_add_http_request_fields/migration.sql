-- AlterTable: add HTTP request check fields (additive, existing rows stay as GET checks)
ALTER TABLE "Monitor" ADD COLUMN     "method" TEXT NOT NULL DEFAULT 'GET';
ALTER TABLE "Monitor" ADD COLUMN     "requestBody" TEXT;
ALTER TABLE "Monitor" ADD COLUMN     "requestHeaders" JSONB;
ALTER TABLE "Monitor" ADD COLUMN     "authType" TEXT;
ALTER TABLE "Monitor" ADD COLUMN     "authHeaderName" TEXT;
ALTER TABLE "Monitor" ADD COLUMN     "encryptedAuthValue" TEXT;
