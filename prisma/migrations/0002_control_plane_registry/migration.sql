-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "control";

-- CreateEnum
CREATE TYPE "control"."ControlStatus" AS ENUM ('ENABLED', 'DISABLED');

-- CreateEnum
CREATE TYPE "control"."ConnectionSharingMode" AS ENUM ('DEDICATED', 'SHARED');

-- CreateEnum
CREATE TYPE "control"."CredentialResidency" AS ENUM ('CENTRAL', 'RUNNER_LOCAL');

-- CreateTable
CREATE TABLE "control"."applications" (
    "id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "keycloak_client_id" TEXT NOT NULL,
    "status" "control"."ControlStatus" NOT NULL DEFAULT 'ENABLED',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control"."ai_connections" (
    "id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "auth_mode" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "sharing_mode" "control"."ConnectionSharingMode" NOT NULL,
    "quota_group_ref" TEXT,
    "status" "control"."ControlStatus" NOT NULL DEFAULT 'ENABLED',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ai_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control"."credential_instances" (
    "id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "secret_ref" TEXT,
    "residency" "control"."CredentialResidency" NOT NULL,
    "runner_ref" TEXT,
    "status" "control"."ControlStatus" NOT NULL DEFAULT 'ENABLED',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "credential_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control"."credential_bindings" (
    "id" UUID NOT NULL,
    "application_id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "profile_ref" TEXT,
    "status" "control"."ControlStatus" NOT NULL DEFAULT 'ENABLED',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credential_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "applications_keycloak_client_id_key" ON "control"."applications"("keycloak_client_id");

-- CreateIndex
CREATE INDEX "credential_instances_connection_status" ON "control"."credential_instances"("connection_id", "status");

-- CreateIndex
CREATE INDEX "credential_bindings_application_status" ON "control"."credential_bindings"("application_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "credential_bindings_scope_key" ON "control"."credential_bindings"("application_id", "connection_id", "profile_ref");

-- AddForeignKey
ALTER TABLE "control"."credential_instances" ADD CONSTRAINT "credential_instances_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "control"."ai_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control"."credential_bindings" ADD CONSTRAINT "credential_bindings_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "control"."applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control"."credential_bindings" ADD CONSTRAINT "credential_bindings_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "control"."ai_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
