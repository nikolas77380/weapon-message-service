-- Migration: Create base chat schema
-- Description: Creates the base tables for the chat system
-- Date: 2025-11-18

-- Ensure chat schema exists
CREATE SCHEMA IF NOT EXISTS chat;

-- Create chats table
CREATE TABLE IF NOT EXISTS chat.chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id INTEGER NOT NULL,
  seller_id INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(buyer_id, seller_id)
);

-- Create indexes for chats
CREATE INDEX IF NOT EXISTS idx_chats_buyer_id ON chat.chats(buyer_id);
CREATE INDEX IF NOT EXISTS idx_chats_seller_id ON chat.chats(seller_id);

-- Create messages table
CREATE TABLE IF NOT EXISTS chat.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID NOT NULL REFERENCES chat.chats(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  product_id INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for messages
CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON chat.messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON chat.messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON chat.messages(created_at);

-- Create chat_context table
CREATE TABLE IF NOT EXISTS chat.chat_context (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID NOT NULL UNIQUE REFERENCES chat.chats(id) ON DELETE CASCADE,
  current_product_id INTEGER,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for chat_context
CREATE INDEX IF NOT EXISTS idx_chat_context_chat_id ON chat.chat_context(chat_id);

-- Add comments
COMMENT ON TABLE chat.chats IS 'Stores chat conversations between buyers and sellers';
COMMENT ON TABLE chat.messages IS 'Stores messages in chats';
COMMENT ON TABLE chat.chat_context IS 'Stores the current context (product) being discussed in a chat';

