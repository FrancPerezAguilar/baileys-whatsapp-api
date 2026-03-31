import { config } from '../config.js';

const ALERT_LEVELS = {
  INFO: 'ℹ️',
  WARNING: '⚠️',
  ERROR: '❌',
  CRITICAL: '🚨'
};

// Deduplication: don't send same alert within this time window (ms)
const DEDUP_WINDOW_MS = 30000; // 30 seconds
const lastSentCache = new Map(); // key -> timestamp

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Generate a short hash for deduplication key
function getAlertKey(alertType, ...args) {
  const data = args.map(a => String(a || '').substring(0, 50)).join('|');
  return `${alertType}:${data}`;
}

function shouldSend(alertKey) {
  const now = Date.now();
  const lastSent = lastSentCache.get(alertKey);

  if (lastSent && (now - lastSent) < DEDUP_WINDOW_MS) {
    console.log(`[Telegram] Deduplicated: "${alertKey}" (sent ${Math.round((now - lastSent)/1000)}s ago)`);
    return false;
  }

  lastSentCache.set(alertKey, now);

  // Cleanup old entries periodically
  if (lastSentCache.size > 100) {
    for (const [key, ts] of lastSentCache.entries()) {
      if (now - ts > DEDUP_WINDOW_MS * 2) lastSentCache.delete(key);
    }
  }

  return true;
}

class TelegramNotifier {
  constructor() {
    this.botToken = null;
    this.chatId = null;
    this.enabled = false;
  }

  configure(botToken, chatId) {
    this.botToken = botToken;
    this.chatId = chatId;
    this.enabled = !!(botToken && chatId);
    
    if (this.enabled) {
      console.log('[Telegram] Notifier configured and enabled');
    } else {
      console.log('[Telegram] Notifier disabled (missing token or chat_id)');
    }
  }

  async send(text, parseMode = 'HTML', disableNotification = false, alertKey = null) {
    if (!this.enabled) {
      console.log(`[Telegram] Alert (not sent - not configured): ${text}`);
      return false;
    }

    // Deduplicate by default text content
    const key = alertKey || getAlertKey('text', text);
    if (!shouldSend(key)) {
      return false;
    }

    try {
      const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.chatId,
          text,
          parse_mode: parseMode,
          disable_notification: disableNotification
        })
      });

      const result = await response.json();

      if (result.ok) {
        console.log(`[Telegram] Alert sent successfully`);
        return true;
      } else {
        console.error(`[Telegram] Send failed:`, result.description);
        return false;
      }
    } catch (error) {
      console.error(`[Telegram] Error sending alert:`, error.message);
      return false;
    }
  }

  async sendPhoto(photoBase64, caption, alertKey = null) {
    if (!this.enabled) {
      console.log(`[Telegram] Photo alert (not sent - not configured): ${caption}`);
      return false;
    }

    // Deduplicate
    const key = alertKey || getAlertKey('photo', caption);
    if (!shouldSend(key)) {
      return false;
    }

    try {
      const url = `https://api.telegram.org/bot${this.botToken}/sendPhoto`;

      // Remove data URL prefix if present
      const base64Data = photoBase64.replace(/^data:image\/\w+;base64,/, '');
      // Convert base64 to binary buffer
      const binaryData = Buffer.from(base64Data, 'base64');

      // Build multipart form manually for Node.js compatibility
      const boundary = `----TelegramBoundary${Date.now()}`;
      const CRLF = '\r\n';

      // chat_id part
      const chatIdPart = Buffer.from(
        `--${boundary}${CRLF}Content-Disposition: form-data; name="chat_id"${CRLF}${CRLF}${this.chatId}`
      );

      // photo part
      const photoHeader = Buffer.from(
        `${CRLF}--${boundary}${CRLF}Content-Disposition: form-data; name="photo"; filename="qr.png"${CRLF}Content-Type: image/png${CRLF}${CRLF}`
      );

      // caption part
      const captionPart = Buffer.from(
        `${CRLF}--${boundary}${CRLF}Content-Disposition: form-data; name="caption"${CRLF}Content-Type: text/html${CRLF}${CRLF}${caption}${CRLF}--${boundary}--${CRLF}`
      );

      // Assemble body
      const body = Buffer.concat([chatIdPart, photoHeader, binaryData, captionPart]);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body
      });

      const result = await response.json();

      if (result.ok) {
        console.log(`[Telegram] Photo sent successfully`);
        return true;
      } else {
        console.error(`[Telegram] Send photo failed:`, result.description);
        return false;
      }
    } catch (error) {
      console.error(`[Telegram] Error sending photo:`, error.message);
      return false;
    }
  }

  // Convenience methods
  async info(message) {
    return this.send(`${ALERT_LEVELS.INFO} <b>INFO</b>\n\n${message}`);
  }

  async warning(message) {
    return this.send(`${ALERT_LEVELS.WARNING} <b>WARNING</b>\n\n${message}`);
  }

  async error(message) {
    return this.send(`${ALERT_LEVELS.ERROR} <b>ERROR</b>\n\n${message}`);
  }

  async critical(message) {
    return this.send(`${ALERT_LEVELS.CRITICAL} <b>CRITICAL</b>\n\n${message}`);
  }

  // Specific alerts
  async alertSessionStarted() {
    if (!shouldSend('alert:session-started')) return false;
    return this.info('🔌 <b>Sesión iniciada</b>\n\nEl bridge de WhatsApp está funcionando correctamente.');
  }

  async alertSessionClosed(reason = 'Unknown') {
    if (!shouldSend('alert:session-closed', reason)) return false;
    return this.error(`📱 <b>Sesión cerrada</b>\n\nRazón: ${reason}\n\nEl bridge necesita atención. Verifica la conexión.`);
  }

  async alertSessionQR(qrImageBase64 = null) {
    if (qrImageBase64 && this.enabled) {
      // QR photos are always sent (time-sensitive, different each time)
      return this.sendPhoto(
        qrImageBase64,
        '📱 <b>QR Code - Escanea con WhatsApp</b>\n\n<i>Este código expira en 60 segundos</i>',
        'alert:qr-session'
      );
    }
    if (!shouldSend('alert:qr-generated')) return false;
    return this.info(`📱 <b>QR Code generado</b>\n\nEscanea el QR para conectar WhatsApp.`);
  }

  async alertSessionConnected() {
    if (!shouldSend('alert:session-connected')) return false;
    return this.info('✅ <b>WhatsApp conectado</b>\n\nSesión activa y funcionando.');
  }

  async alertChatwootMessageFailed(error, sender) {
    if (!shouldSend('alert:chatwoot-failed', sender, error)) return false;
    return this.error(`❌ <b>Mensaje a Chatwoot falló</b>\n\nDe: ${escapeHtml(sender)}\nError: ${escapeHtml(error)}\n\nEl mensaje se reintentará automáticamente.`);
  }

  async alertChatwootAPIFailed(attempt, maxAttempts) {
    if (!shouldSend('alert:chatwoot-api-failed', attempt)) return false;
    return this.warning(`⚠️ <b>Chatwoot API falló</b>\n\nIntento ${attempt}/${maxAttempts}\n\nSe reintentará automáticamente.`);
  }

  async alertChatwootMessageSent(to, preview) {
    if (!shouldSend('alert:chatwoot-sent', to)) return false;
    return this.info(`📤 <b>Mensaje enviado a Chatwoot</b>\n\nPara: ${to}\n${preview.substring(0, 100)}`);
  }

  async alertBridgeStarted() {
    if (!shouldSend('alert:bridge-started')) return false;
    return this.info('🚀 <b>Bridge iniciado</b>\n\nEl servicio está arrancando...');
  }

  async alertBridgeError(error) {
    if (!shouldSend('alert:bridge-error', error.substring(0, 100))) return false;
    return this.critical(`🚨 <b>Error crítico en Bridge</b>\n\n${error}`);
  }

  async alertRateLimited(identifier, count) {
    if (!shouldSend('alert:rate-limited', identifier)) return false;
    return this.warning(`⚠️ <b>Rate limit</b>\n\n${escapeHtml(identifier)} ha enviado ${count} mensajes. Mensajes ignorados por ahora.`);
  }

  async alertMediaDownloadFailed(msgId, error) {
    if (!shouldSend('alert:media-failed', msgId)) return false;
    return this.warning(`⚠️ <b>Descarga de media falló</b>\n\nMensaje: ${msgId}\nError: ${error}`);
  }

  async alertRetryFailed(jobId, attempts) {
    if (!shouldSend('alert:retry-failed', jobId)) return false;
    return this.error(`❌ <b>Reintento fallido</b>\n\nJob: ${jobId}\nIntentos: ${attempts}\n\nSe necesita intervención manual.`);
  }
}

export const telegramNotifier = new TelegramNotifier();
export default telegramNotifier;
