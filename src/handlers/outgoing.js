import state from '../state/store.js';
import crypto from 'crypto';

export async function handleOutgoingMessage(sock, payload) {
  try {
    const { conversation, message, sender } = payload;
    
    // Only process outgoing messages
    if (message.message_type !== 'outgoing') {
      return;
    }

    // Skip auto messages (bot responses)
    if (message.private) {
      return;
    }

    // Get WhatsApp JID from conversation
    const jid = state.getJidFromConversation(conversation.id);
    
    if (!jid) {
      console.log('[Outgoing] No WhatsApp JID found for conversation', conversation.id);
      return;
    }

    console.log(`[Outgoing] Sending to ${jid}:`, message.content?.substring(0, 100));

    // Prepare message options
    const msgOptions = {
      quoted: undefined
    };

    // Handle attachments if any
    if (message.attachments && message.attachments.length > 0) {
      const attachment = message.attachments[0];
      
      if (attachment.type === 'image') {
        // Download from Chatwoot and send as image
        // For now, just send text as we don't have the actual file
        await sock.sendMessage(jid, {
          image: { url: attachment.data_url },
          caption: message.content || ''
        });
      } else if (attachment.type === 'audio') {
        // Send audio
        await sock.sendMessage(jid, {
          audio: { url: attachment.data_url },
          mimetype: 'audio/mp4'
        });
      } else {
        // Send as document
        await sock.sendMessage(jid, {
          document: { url: attachment.data_url },
          fileName: attachment.filename || 'file',
          caption: message.content || ''
        });
      }
    } else {
      // Text message
      // Check if it's a reply
      if (message.in_reply_to) {
        const parentWaMsgId = state.getByCwMsgId(message.in_reply_to);
        if (parentWaMsgId) {
          msgOptions.quoted = { remoteJid: jid, id: parentWaMsgId };
        }
      }

      await sock.sendMessage(jid, {
        text: message.content,
        ...msgOptions
      });
    }

    console.log(`[Outgoing] Message sent successfully to ${jid}`);
  } catch (error) {
    console.error('[Outgoing] Error sending message:', error);
  }
}

export function validateWebhook(rawBody, signature, secret) {
  if (!secret) {
    console.warn('[Webhook] No WEBHOOK_SECRET configured — webhook validation disabled (INSECURE)');
    return true; // Allow if no secret configured (dev mode)
  }

  if (!signature) {
    console.warn('[Webhook] No signature header received');
    return false;
  }

  try {
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody));
    const expected = hmac.digest('hex');

    // Use timing-safe comparison to prevent timing attacks
    const sigBuffer = Buffer.from(signature, 'utf8');
    const expectedBuffer = Buffer.from(expected, 'utf8');

    if (sigBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
  } catch (error) {
    console.error('[Webhook] Validation error:', error.message);
    return false;
  }
}

export function parseChatwootWebhook(body) {
  // Parse the Chatwoot webhook payload
  const { event, conversation, message, user } = body;
  
  return {
    event,
    conversation,
    message,
    sender: user
  };
}
