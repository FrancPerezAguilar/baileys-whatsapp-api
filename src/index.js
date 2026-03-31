import { default as makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } from '@WhiskeySockets/baileys';
import express from 'express';
import cors from 'cors';
import QRCode from 'qrcode';
import { Boom } from '@hapi/boom';
import path from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, existsSync, readFileSync } from 'fs';

import { config } from './config.js';
import chatwoot from './services/chatwoot.js';
import state from './state/store.js';
import { handleIncomingMessage, handleMessageDelete } from './handlers/incoming.js';
import { handleOutgoingMessage, parseChatwootWebhook } from './handlers/outgoing.js';
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
        keys: makeCacheableSignalKeyStore(state.keys, console.log),
      },
      version,
      printQRInTerminal: true,
      logger: console,
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
        this.qrCode = qr;
      }

      if (connection === 'connected') {
        this.isConnected = true;
        console.log('[Baileys] Connected to WhatsApp!');
      }

      if (connection === 'close') {
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
        console.log('[Baileys] Connection closed. Reconnecting:', shouldReconnect);
        
        if (shouldReconnect) {
          this.isConnected = false;
          await this.start();
        } else {
          console.log('[Baileys] Logged out - clear auth to reconnect');
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
    this.sock.ev.on('messages.delete', async (keys) => {
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
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    connected: bridge.isReady(),
    session: config.session.id 
  });
});

// Get QR code
app.get('/qr', async (req, res) => {
  try {
    const qr = await bridge.getQR();
    res.json(qr);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Send message
app.post('/send', async (req, res) => {
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

// Webhook from Chatwoot
app.post('/webhook', async (req, res) => {
  try {
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
app.listen(PORT, () => {
  console.log(`[API] Bridge API running on port ${PORT}`);
  console.log(`[API] Webhook endpoint: http://localhost:${PORT}/webhook`);
  console.log(`[API] Configure this URL in Chatwoot webhooks`);
});

// Start webhook receiver on separate port
const webhookApp = express();
webhookApp.use(express.json());

webhookApp.post('/', async (req, res) => {
  try {
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

export { bridge };
