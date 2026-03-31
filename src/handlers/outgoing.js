import state from '../state/store.js';

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
        const parentMapping = state.getByCwMsgId(message.in_reply_to);
        if (parentMapping) {
          msgOptions.quoted = { remoteJid: jid, id: parentMapping };
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

export function validateWebhook(payload, secret) {
  if (!secret) return true; // Skip validation if no secret configured
  
  // Chatwoot sends signature in headers
  // Could implement HMAC validation here
  return true;
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
