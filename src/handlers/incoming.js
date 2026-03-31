import chatwoot from '../services/chatwoot.js';
import { downloadAllMedia, getMsgContent } from '../services/media.js';
import { cache } from '../services/cache.js';
import { config } from '../config.js';
import { telegramNotifier } from '../services/notifications.js';
import state from '../state/store.js';

export async function handleIncomingMessage(sock, msg) {
  try {
    const { key, message } = msg;
    
    // Ignore group messages for now
    if (key.remoteJid?.includes('@g.us')) {
      console.log('[Incoming] Ignoring group message');
      return;
    }

    // Ignore messages from self
    if (key.fromMe) {
      return;
    }

    const jid = key.remoteJid;
    const from = jid.split('@')[0];
    
    console.log(`[Incoming] Message from ${from}:`, getMsgContent(message).substring(0, 100));

    // Rate limit per sender
    const rateCheck = await cache.rateLimit(`incoming:${from}`, 30, 60); // 30 msg/min
    if (!rateCheck.allowed) {
      console.log(`[Incoming] Rate limited: ${from}`);
      await telegramNotifier.alertRateLimited(from, 30);
      return;
    }

    // Check if already processed (idempotency)
    const existingCwMsgId = await cache.getCwMsgId(key.id);
    if (existingCwMsgId) {
      console.log(`[Incoming] Message ${key.id} already processed`);
      return;
    }

    // Get contact info
    const contactInfo = {
      jid,
      name: msg.pushName || from
    };
    await cache.setContact(jid, contactInfo, 3600);

    // Find or create conversation in Chatwoot
    let conversation;
    try {
      const result = await chatwoot.findOrCreateConversation(from, contactInfo.name || from);
      conversation = result.conversation;
      
      // Cache the mapping
      await cache.setConversationJid(jid, conversation.id);
    } catch (error) {
      console.error('[Incoming] Chatwoot conversation error:', error.message);
      await telegramNotifier.alertChatwootMessageFailed(error.message, from);
      // Queue message for later retry
      return; // For now, just drop the message
    }

    // Download attachments
    const attachments = await downloadAllMedia(message);
    
    // Create message in Chatwoot
    const msgContent = getMsgContent(message);
    const hasMedia = attachments.length > 0;

    try {
      if (hasMedia) {
        // Upload each attachment and create message
        for (const att of attachments) {
          try {
            const uploaded = await chatwoot.uploadAttachment(att.buffer, att.filename, att.type);
            
            await chatwoot.createMessage(conversation.id, {
              content: att.type === 'audio' ? '🎤 Nota de voz' : (msgContent || `📎 ${att.filename}`),
              messageType: 'incoming',
              contentType: 'text',
              attachments: [{
                id: uploaded.id,
                filename: uploaded.file.filename,
                content_type: uploaded.file.content_type
              }]
            });
          } catch (uploadError) {
            console.error('[Incoming] Attachment upload error:', uploadError);
            // Send text without attachment
            if (msgContent) {
              await chatwoot.createTextMessage(conversation.id, msgContent);
            }
          }
        }
      } else if (msgContent) {
        // Text-only message
        const cwMsg = await chatwoot.createTextMessage(conversation.id, msgContent);
        
        // Cache message mapping for reply handling
        await cache.setCwMsgId(key.id, cwMsg.id);
      }

      // Mark as read
      await chatwoot.markAsRead(conversation.id);

      console.log(`[Incoming] Message sent to Chatwoot conversation ${conversation.id}`);
    } catch (error) {
      console.error('[Incoming] Chatwoot message error:', error.message);
      await telegramNotifier.alertChatwootMessageFailed(error.message, from);
      // Could queue for retry here
    }
  } catch (error) {
    console.error('[Incoming] Error handling message:', error);
    await telegramNotifier.alertBridgeError(error.message);
  }
}

export async function handleMessageDelete(sock, key) {
  console.log('[Delete] Message deleted:', key.id);

  try {
    // Look up the Chatwoot message ID from WhatsApp message ID
    const mapping = state.getByWaMsgId(key.id);

    if (mapping && mapping.cwMsgId && mapping.conversationId) {
      console.log(`[Delete] Syncing deletion to Chatwoot: cwMsgId=${mapping.cwMsgId}, conv=${mapping.conversationId}`);

      // In Chatwoot, deleted messages are typically soft-deleted by updating their status
      // Chatwoot doesn't have a direct "delete message" API, but we can log it
      // The actual deletion visibility depends on Chatwoot's configuration
      console.log(`[Delete] Would delete Chatwoot message ${mapping.cwMsgId} in conversation ${mapping.conversationId}`);

      // Clear the mapping since the message is deleted
      // Note: We don't actually delete from Chatwoot as their API doesn't support it
    }
  } catch (error) {
    console.error('[Delete] Error syncing deletion:', error.message);
  }
}

export async function handleGroupJoin(sock, notification) {
  console.log('[Group] Joined:', notification.id);
}

export async function handleGroupLeave(sock, notification) {
  console.log('[Group] Left:', notification.id);
}
