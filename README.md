# Marketplace Message Service

Сервис для обработки сообщений в реальном времени на основе WebSocket (Socket.io) для marketplace приложения.

## Возможности

- ✅ WebSocket соединения для обмена сообщениями в реальном времени
- ✅ Статусы онлайн/оффлайн пользователей (хранятся в Redis)
- ✅ Статус "печатает" (is typing) с автоматическим истечением через 10 секунд
- ✅ Работа с той же базой данных PostgreSQL, что и marketplace-api
- ✅ Использование схемы `chat` для изоляции данных сообщений
- ✅ Поддержка создания чатов, отправки сообщений, получения истории

## Технологии

- **NestJS** - фреймворк для Node.js
- **Socket.io** - WebSocket библиотека
- **PostgreSQL** - база данных (та же, что и в marketplace-api)
- **Redis** - для хранения статусов онлайн и "is typing"
- **ioredis** - клиент для Redis

## Установка

```bash
npm install
```

## Настройка

1. Скопируйте `.env.example` в `.env`:
```bash
cp .env.example .env
```

2. Настройте переменные окружения в `.env`:
   - **DATABASE_*** - настройки подключения к PostgreSQL (те же, что и в marketplace-api)
   - **REDIS_*** - настройки подключения к Redis
   - **PORT** - порт для запуска сервиса (по умолчанию 3001)

## Запуск

### Разработка
```bash
npm run start:dev
```

### Продакшн
```bash
npm run build
npm run start:prod
```

## WebSocket API

Сервис работает на namespace `/chat`. Подключение с JWT токеном:

```javascript
import io from 'socket.io-client';

const token = 'your-jwt-token'; // JWT токен из marketplace-api

const socket = io('http://localhost:3001/chat', {
  auth: {
    token: token
  },
  // Или через query параметры:
  // query: {
  //   token: token
  // }
});
```

### Аутентификация

Сервис использует оптимизированную проверку токенов для высокой производительности:

1. **При подключении**: Полная проверка токена через `marketplace-api` (один раз)
2. **При действиях**: Быстрая локальная проверка (парсинг JWT и проверка `exp` без запроса к API)
3. **Кеширование**: Результаты проверки токенов кешируются в Redis на 10 минут

Это обеспечивает:
- ✅ Минимальную задержку при отправке сообщений
- ✅ Отсутствие нагрузки на marketplace-api при каждом действии
- ✅ Высокую производительность real-time чата 

**События аутентификации:**

- `auth:error` - Ошибка аутентификации (токен отсутствует или невалиден)
  ```javascript
  socket.on('auth:error', (data) => {
    console.log('Auth error:', data);
    // { error: '...', code: 'TOKEN_REQUIRED' | 'TOKEN_INVALID' | 'AUTH_SERVICE_ERROR' }
  });
  ```

- `auth:token-expired` - Токен истек (нужно обновить)
  ```javascript
  socket.on('auth:token-expired', (data) => {
    console.log('Token expired:', data);
    // { error: 'Token expired', code: 'TOKEN_EXPIRED' }
    // Обновите токен и отправьте событие auth:refresh-token
  });
  ```

**Обновление токена:**

Если токен истек во время работы, можно обновить его без переподключения:

```javascript
socket.emit('auth:refresh-token', {
  token: 'new-jwt-token'
}, (response) => {
  if (response.success) {
    console.log('Token refreshed successfully');
  }
});
```

### События (Events)

#### Клиент -> Сервер

**`message:send`** - Отправить сообщение
```javascript
socket.emit('message:send', {
  chatId: 'uuid',
  text: 'Текст сообщения',
  productId: 123 // опционально
});
```

**`typing:start`** - Начать печатать
```javascript
socket.emit('typing:start', {
  chatId: 'uuid'
});
```

**`typing:stop`** - Остановить печатать
```javascript
socket.emit('typing:stop', {
  chatId: 'uuid'
});
```

**`chat:join`** - Присоединиться к чату
```javascript
socket.emit('chat:join', {
  chatId: 'uuid'
});
```

**`chat:create`** - Создать новый чат
```javascript
socket.emit('chat:create', {
  buyerId: 123,
  sellerId: 456
});
```

**`users:online`** - Получить список онлайн пользователей
```javascript
socket.emit('users:online');
```

#### Сервер -> Клиент

**`message:new`** - Новое сообщение
```javascript
socket.on('message:new', (data) => {
  console.log('New message:', data);
  // { id, chatId, senderId, text, productId, createdAt }
});
```

**`typing:start`** - Пользователь начал печатать
```javascript
socket.on('typing:start', (data) => {
  console.log('User typing:', data);
  // { chatId, userId }
});
```

**`typing:stop`** - Пользователь перестал печатать
```javascript
socket.on('typing:stop', (data) => {
  console.log('User stopped typing:', data);
  // { chatId, userId }
});
```

**`user:online`** - Пользователь онлайн
```javascript
socket.on('user:online', (data) => {
  console.log('User online:', data);
  // { userId }
});
```

**`user:offline`** - Пользователь оффлайн
```javascript
socket.on('user:offline', (data) => {
  console.log('User offline:', data);
  // { userId }
});
```

**`chat:created`** - Чат создан
```javascript
socket.on('chat:created', (data) => {
  console.log('Chat created:', data);
  // { id, buyerId, sellerId, createdAt }
});
```

## Структура базы данных

Сервис использует схему `chat` в PostgreSQL:

- **chat.chats** - таблица чатов (buyer_id, seller_id)
- **chat.messages** - таблица сообщений
- **chat.chat_context** - контекст чата (текущий продукт)

## Redis структура

### Статусы онлайн
- `user:{userId}:online` - ключ с TTL 5 минут, значение - socketId
- `online:users` - Set с ID онлайн пользователей

### Статусы "is typing"
- `chat:{chatId}:typing:{userId}` - ключ с TTL 10 секунд

## Аутентификация

Сервис использует JWT токены, которые проверяются через `marketplace-api`. 

**Настройка:**

1. Убедитесь, что `MARKETPLACE_API_URL` в `.env` указывает на правильный адрес marketplace-api
2. При подключении передавайте JWT токен через `auth.token` или `query.token`
3. Сервис автоматически проверяет токен при подключении и перед каждым действием
4. Если токен истек, клиент получит событие `auth:token-expired` и может обновить токен через `auth:refresh-token`

## Разработка

Проект использует TypeScript и NestJS. Структура:

```
src/
├── config/          # Конфигурация (database, redis)
├── database/        # Модуль для работы с PostgreSQL
├── redis/           # Модуль для работы с Redis
├── messages/        # Сервис для работы с сообщениями
├── gateway/         # WebSocket Gateway
└── app.module.ts    # Главный модуль
```

## Лицензия

UNLICENSED
