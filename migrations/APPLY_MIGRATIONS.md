# Применение миграций

## Миграция 003_add_user_chat_settings.sql

Добавляет таблицу `chat.user_chat_settings` с признаками архивирования и избранного + необходимые индексы.

## Новая миграция: 004_add_message_indexes.sql

Добавляет составные индексы для `chat.messages`, чтобы ускорить:
- постраничную загрузку сообщений по чату (`ORDER BY created_at DESC`)
- подсчёт и выбор непрочитанных сообщений (фильтры по `chat_id` и `sender_id`)

### Применение миграций:

```bash
# Подключитесь к базе данных и примените нужную миграцию
psql $DATABASE_URL -f migrations/004_add_message_indexes.sql
```

### Проверка применения:

```sql
-- Проверить наличие новых индексов
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE schemaname = 'chat' AND tablename = 'messages'
  AND indexname IN (
    'idx_messages_chat_id_created_at',
    'idx_messages_chat_id_sender_id_created_at'
  );
```

### Откат миграции (если необходимо):

```sql
DROP INDEX IF EXISTS chat.idx_messages_chat_id_created_at;
DROP INDEX IF EXISTS chat.idx_messages_chat_id_sender_id_created_at;
```


