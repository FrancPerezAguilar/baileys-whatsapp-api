import { config } from '../config.js';

const ALERT_LEVELS = {
  INFO: 'ℹ️',
  WARNING: '⚠️',
  ERROR: '❌',
  CRITICAL: '🚨'
};

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
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

  async send(text, parseMode = 'HTML', disableNotification = false) {
    if (!this.enabled) {
      console.log(`[Telegram] Alert (not sent - not configured): ${text}`);
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

  async sendPhoto(photoBase64, caption, disableNotification = false) {
    if (!this.enabled) {
      console.log(`[Telegram] Photo alert (not sent - not configured): ${caption}`);
      return false;
    }

    try {
      const url = `https://api.telegram.org/bot${this.botToken}/sendPhoto`;

      // Remove data URL prefix if present
      const base64Data = photoBase64.replace(/^data:image\/\w+;base64,/, '');

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.chatId,
          photo: `data:image/png;base64,${base64Data}`,
          caption,
          parse_mode: 'HTML',
          disable_notification: disableNotification
        })
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
    return this.info('🔌 <b>Sesión iniciada</b>\n\nEl bridge de WhatsApp está funcionando correctamente.');
  }

  async alertSessionClosed(reason = 'Unknown') {
    return this.error(`📱 <b>Sesión cerrada</b>\n\nRazón: ${reason}\n\nEl bridge necesita atención. Verifica la conexión.`);
  }

  async alertSessionQR(qrImageBase64 = null) {
    if (qrImageBase64 && this.enabled) {
      return this.sendPhoto(
        qrImageBase64,
        '📱 <b>QR Code - Escanea con WhatsApp</b>\n\n<i>Este código expira en 60 segundos</i>'
      );
    }
    return this.info(`📱 <b>QR Code generado</b>\n\nEscanea el QR para conectar WhatsApp.`);
  }

  async alertSessionConnected() {
    return this.info('✅ <b>WhatsApp conectado</b>\n\nSesión activa y funcionando.');
  }

  async alertChatwootMessageFailed(error, sender) {
    return this.error(`❌ <b>Mensaje a Chatwoot falló</b>\n\nDe: ${escapeHtml(sender)}\nError: ${escapeHtml(error)}\n\nEl mensaje se reintentará automáticamente.`);
  }

  async alertChatwootAPIFailed(attempt, maxAttempts) {
    return this.warning(`⚠️ <b>Chatwoot API falló</b>\n\nIntento ${attempt}/${maxAttempts}\n\nSe reintentará automáticamente.`);
  }

  async alertChatwootMessageSent(to, preview) {
    return this.info(`📤 <b>Mensaje enviado a Chatwoot</b>\n\nPara: ${to}\n${preview.substring(0, 100)}`);
  }

  async alertBridgeStarted() {
    return this.info('🚀 <b>Bridge iniciado</b>\n\nEl servicio está arrancando...');
  }

  async alertBridgeError(error) {
    return this.critical(`🚨 <b>Error crítico en Bridge</b>\n\n${error}`);
  }

  async alertRateLimited(identifier, count) {
    return this.warning(`⚠️ <b>Rate limit</b>\n\n${escapeHtml(identifier)} ha enviado ${count} mensajes. Mensajes ignorados por ahora.`);
  }

  async alertMediaDownloadFailed(msgId, error) {
    return this.warning(`⚠️ <b>Descarga de media falló</b>\n\nMensaje: ${msgId}\nError: ${error}`);
  }

  async alertRetryFailed(jobId, attempts) {
    return this.error(`❌ <b>Reintento fallido</b>\n\nJob: ${jobId}\nIntentos: ${attempts}\n\nSe necesita intervención manual.`);
  }
}

export const telegramNotifier = new TelegramNotifier();
export default telegramNotifier;
