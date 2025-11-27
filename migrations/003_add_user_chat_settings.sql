-- Migration: Add user chat settings
-- Description: Creates table for user-specific chat settings (archived, favorite)
-- Date: 2025-11-21

-- Create user_chat_settings table
CREATE TABLE IF NOT EXISTS chat.user_chat_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID NOT NULL REFERENCES chat.chats(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  is_archived BOOLEAN DEFAULT FALSE,
  is_favorite BOOLEAN DEFAULT FALSE,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(chat_id, user_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_user_chat_settings_chat_id ON chat.user_chat_settings(chat_id);
CREATE INDEX IF NOT EXISTS idx_user_chat_settings_user_id ON chat.user_chat_settings(user_id);
CREATE INDEX IF NOT EXISTS idx_user_chat_settings_archived ON chat.user_chat_settings(user_id, is_archived) WHERE is_archived = TRUE;
CREATE INDEX IF NOT EXISTS idx_user_chat_settings_favorite ON chat.user_chat_settings(user_id, is_favorite) WHERE is_favorite = TRUE;

-- Add comment
COMMENT ON TABLE chat.user_chat_settings IS 'Stores user-specific settings for chats (archived, favorite)';


