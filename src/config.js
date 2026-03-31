import dotenv from 'dotenv';
dotenv.config();

export const config = {
  chatwoot: {
    url: process.env.CHATWOOT_URL || 'http://localhost:3000',
    apiKey: process.env.CHATWOOT_API_KEY,
    inboxId: process.env.CHATWOOT_INBOX_ID,
    accountId: process.env.CHATWOOT_ACCOUNT_ID,
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD || null,
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || null,
    chatId: process.env.TELEGRAM_CHAT_ID || null,
  },
  session: {
    id: process.env.SESSION_ID || 'default',
    dir: process.env.SESSION_DIR || './auth',
  },
  server: {
    port: parseInt(process.env.PORT || '3001'),
  },
  webhook: {
    secret: process.env.WEBHOOK_SECRET,
  }
};
