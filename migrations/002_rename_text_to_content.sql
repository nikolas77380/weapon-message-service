-- Migration: Rename text column to content in messages table
-- Description: Renames the text column to content to match the expected schema
-- Date: 2025-11-19

-- Rename text column to content
ALTER TABLE chat.messages RENAME COLUMN text TO content;

