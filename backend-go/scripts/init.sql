-- Initialize PostgreSQL database for Crypto Analyzer
-- This script runs automatically when the PostgreSQL container starts for the first time

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- Create indexes for common queries (will be created by Ent migrations)
-- This is a placeholder for any custom SQL that needs to run before schema migration

-- Set timezone to UTC
SET timezone = 'UTC';
