-- Migration: Create read_messages table
-- Description: Tracks which messages have been read by which users
-- Date: 2025-11-18

-- Ensure chat schema exists
CREATE SCHEMA IF NOT EXISTS chat;

-- Create read_messages table
CREATE TABLE IF NOT EXISTS chat.read_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES chat.messages(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  read_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(message_id, user_id)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_read_messages_message_id ON chat.read_messages(message_id);
CREATE INDEX IF NOT EXISTS idx_read_messages_user_id ON chat.read_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_read_messages_message_user ON chat.read_messages(message_id, user_id);

-- Add comment to table
COMMENT ON TABLE chat.read_messages IS 'Tracks which messages have been read by which users';
COMMENT ON COLUMN chat.read_messages.message_id IS 'Reference to the message that was read';
COMMENT ON COLUMN chat.read_messages.user_id IS 'ID of the user who read the message';
COMMENT ON COLUMN chat.read_messages.read_at IS 'Timestamp when the message was marked as read';

