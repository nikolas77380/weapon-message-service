-- Migration: Add composite indexes for chat.messages performance
-- Date: 2025-11-24
-- Purpose: Optimize frequent chat.messages queries that filter by chat_id and order by created_at,
--          and unread-count queries that also filter sender_id.

-- Improve retrieval of latest messages per chat (ORDER BY created_at DESC/LIMIT)
-- and range scans by created_at inside a chat.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_chat_id_created_at
ON chat.messages (chat_id, created_at DESC);

-- Speed up unread queries filtering by chat and excluding the current user,
-- and still preserve ordering when needed.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_chat_id_sender_id_created_at
ON chat.messages (chat_id, sender_id, created_at DESC);

COMMENT ON INDEX chat.idx_messages_chat_id_created_at IS
  'Supports chat-scoped message pagination ordered by created_at DESC';

COMMENT ON INDEX chat.idx_messages_chat_id_sender_id_created_at IS
  'Supports unread message queries filtering by chat_id and sender_id, ordered by created_at DESC';


