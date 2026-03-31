import { default as makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } from '@WhiskeySockets/baileys';
import express from 'express';
import cors from 'cors';
import QRCode from 'qrcode';
import path from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, existsSync, readFileSync } from 'fs';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'warn' });

import { config } from './config.js';
import chatwoot from './services/chatwoot.js';
import state from './state/store.js';
import { cache } from './services/cache.js';
import { retryQueue } from './services/retryQueue.js';
import { telegramNotifier } from './services/notifications.js';
import { handleIncomingMessage, handleMessageDelete } from './handlers/incoming.js';
import { handleOutgoingMessage, parseChatwootWebhook, validateWebhook } from './handlers/outgoing.js';
import { downloadAllMedia } from './services/media.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Ensure directories exist
['./auth', './data', './media', './logs'].forEach(dir => {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
});

class WhatsAppBridge {
  constructor() {
    this.sock = null;
    this.authDir = config.session.dir;
    this.qrCode = null;
    this.isConnected = false;
    this.ev = null;
  }

  async start() {
    console.log('[Baileys] Starting WhatsApp bridge...');
    
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
    const { version } = await fetchLatestBaileysVersion();

    this.sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger.info.bind(logger)),
      },
      version,
      printQRInTerminal: true,
      logger,
      defaultQuotedTimeoutMs: 0,
      generateHighQualityLinkPreview: true,
      getMessage: async (key) => {
        const msg = this.sock?.store?.messages[key.remoteJid]?.get(key.id);
        return msg?.message || null;
      }
    });

    this.ev = this.sock.ev;

    // Save credentials on update
    this.sock.ev.on('creds.update', saveCreds);

    // Handle connection updates
    this.sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        this.qrCode = qr;
        console.log('[Baileys] QR Code received - scan with WhatsApp');
        await telegramNotifier.alertSessionQR();
      }

      if (connection === 'connected') {
        this.isConnected = true;
        console.log('[Baileys] Connected to WhatsApp!');
        await telegramNotifier.alertSessionConnected();
      }

      if (connection === 'close') {
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
        const reason = lastDisconnect?.error?.message || 'Unknown';
        
        console.log('[Baileys] Connection closed. Reconnecting:', shouldReconnect, 'Reason:', reason);
        
        if (shouldReconnect) {
          this.isConnected = false;
          await telegramNotifier.alertSessionClosed(`Reconectando automáticamente. Razón: ${reason}`);
          await this.start();
        } else {
          console.log('[Baileys] Logged out - clear auth to reconnect');
          await telegramNotifier.alertSessionClosed('Sesión cerrada - requiere re-autenticación');
          state.clear();
        }
      }
    });

    // Handle incoming messages
    this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type === 'notify') {
        for (const msg of messages) {
          if (!msg.key.fromMe) {
            await handleIncomingMessage(this.sock, msg);
          }
        }
      }
    });

    // Handle message deletion
    this.sock.ev.on('messages.delete', async (deleteInfo) => {
      const keys = deleteInfo?.keys || [];
      for (const key of keys) {
        await handleMessageDelete(this.sock, key);
      }
    });

    // Handle presence updates
    this.sock.ev.on('presence.update', async (update) => {
      console.log('[Presence]', update);
    });

    return this.sock;
  }

  async getQR() {
    if (this.isConnected) {
      return { connected: true };
    }
    
    if (this.qrCode) {
      try {
        const qrImage = await QRCode.toDataURL(this.qrCode);
        return { qr: qrImage };
      } catch (error) {
        return { error: error.message };
      }
    }
    
    return { waiting: true };
  }

  async sendText(toJid, text) {
    if (!this.sock || !this.isConnected) {
      throw new Error('Not connected to WhatsApp');
    }

    const jid = toJid.includes('@') ? toJid : `${toJid}@s.whatsapp.net`;
    
    const result = await this.sock.sendMessage(jid, { text });
    return result;
  }

  async sendMedia(toJid, mediaBuffer, mediaType, caption = '') {
    if (!this.sock || !this.isConnected) {
      throw new Error('Not connected to WhatsApp');
    }

    const jid = toJid.includes('@') ? toJid : `${toJid}@s.whatsapp.net`;

    const options = { caption };
    
    if (mediaType === 'image') {
      options.image = mediaBuffer;
    } else if (mediaType === 'video') {
      options.video = mediaBuffer;
    } else if (mediaType === 'audio') {
      options.audio = mediaBuffer;
      options.mimetype = 'audio/ogg; codecs=opus';
    } else {
      options.document = mediaBuffer;
    }

    const result = await this.sock.sendMessage(jid, options);
    return result;
  }

  isReady() {
    return this.isConnected && this.sock !== null;
  }
}

// Create bridge instance
const bridge = new WhatsAppBridge();

// Start bridge automatically
bridge.start().catch(console.error);

// Express app for API
const app = express();
app.use(cors({
  origin: config.chatwoot.url,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'X-Api-Key', 'Authorization']
}));
app.use(express.json({ limit: '1mb' }));

// Authentication middleware
function authMiddleware(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;

  if (!config.webhook.secret) {
    console.warn('[Auth] No WEBHOOK_SECRET configured — auth disabled (INSECURE)');
    return next();
  }

  if (!apiKey || apiKey !== config.webhook.secret) {
    return res.status(401).json({ error: 'Unauthorized: invalid or missing X-Api-Key header' });
  }
  next();
}

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    connected: bridge.isReady(),
    session: config.session.id 
  });
});

// Get QR code (protected)
app.get('/qr', authMiddleware, async (req, res) => {
  try {
    const qr = await bridge.getQR();
    res.json(qr);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Send message (protected)
app.post('/send', authMiddleware, async (req, res) => {
  try {
    const { to, text } = req.body;
    
    if (!to || !text) {
      return res.status(400).json({ error: 'Missing "to" or "text"' });
    }

    await bridge.sendText(to, text);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Webhook from Chatwoot (validated via HMAC)
app.post('/webhook', async (req, res) => {
  try {
    const signature = req.headers['x-chatwoot-signature'];
    if (!validateWebhook(req.body, signature, config.webhook.secret)) {
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }

    const payload = parseChatwootWebhook(req.body);
    await handleOutgoingMessage(bridge.sock, payload);
    res.json({ success: true });
  } catch (error) {
    console.error('[Webhook] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Start server
const PORT = config.server.port;
app.listen(PORT, async () => {
  console.log(`[API] Bridge API running on port ${PORT}`);
  console.log(`[API] Webhook endpoint: http://localhost:${PORT}/webhook`);
  console.log(`[API] Configure this URL in Chatwoot webhooks`);
  
  // Configure Telegram notifier
  telegramNotifier.configure(
    config.telegram.botToken,
    config.telegram.chatId
  );
  
  // Send startup alert
  await telegramNotifier.alertBridgeStarted();
  
  // Connect to Redis
  const redisConnected = await cache.connect();
  if (redisConnected) {
    console.log('[API] Redis connected - caching enabled');
    
    // Set up retry queue executor
    retryQueue.setExecutor(async (job) => {
      console.log(`[RetryQueue] Executing job:`, job.type || 'api_call');
      return { success: true };
    });
    
    // Start retry queue
    retryQueue.startProcessor();
    console.log('[API] Retry queue processor started');
  } else {
    console.warn('[API] Redis not available - running without cache/retry');
  }
});

// Start webhook receiver on separate port
const webhookApp = express();
webhookApp.use(express.json({ limit: '1mb' }));

webhookApp.post('/', async (req, res) => {
  try {
    const signature = req.headers['x-chatwoot-signature'];
    if (!validateWebhook(req.body, signature, config.webhook.secret)) {
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }

    const payload = parseChatwootWebhook(req.body);
    await handleOutgoingMessage(bridge.sock, payload);
    res.json({ success: true });
  } catch (error) {
    console.error('[Webhook] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

const WEBHOOK_PORT = config.server.webhookPort;
webhookApp.listen(WEBHOOK_PORT, () => {
  console.log(`[Webhook] Receiver running on port ${WEBHOOK_PORT}`);
});

// Graceful shutdown
async function gracefulShutdown(signal) {
  console.log(`[Bridge] ${signal} received, shutting down gracefully...`);
  retryQueue.stop();
  cache.stop();
  if (bridge.sock) {
    bridge.sock.end(undefined);
  }
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export { bridge };
