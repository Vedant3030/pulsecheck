-- AlterTable: plan + billing fields (all existing users stay "free")
ALTER TABLE "User" ADD COLUMN     "plan" TEXT NOT NULL DEFAULT 'free';
ALTER TABLE "User" ADD COLUMN     "stripeCustomerId" TEXT;
ALTER TABLE "User" ADD COLUMN     "subscriptionStatus" TEXT;
