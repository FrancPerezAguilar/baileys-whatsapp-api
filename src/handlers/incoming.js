import chatwoot from '../services/chatwoot.js';
import { downloadAllMedia, getMsgContent } from '../services/media.js';
import state from '../state/store.js';
import { config } from '../config.js';

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

    // Get or create contact
    const contactInfo = state.getOrCreateContact(jid);
    
    // Find or create conversation in Chatwoot
    let { contact, conversation } = await chatwoot.findOrCreateConversation(
      from,
      contactInfo.name || from
    );

    // Save conversation mapping
    state.setConversation(jid, conversation.id);

    // Download attachments
    const attachments = await downloadAllMedia(message);
    
    // Create message in Chatwoot
    const msgContent = getMsgContent(message);
    const hasMedia = attachments.length > 0;

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
      await chatwoot.createTextMessage(conversation.id, msgContent);
    }

    // Save message mapping
    // Note: We'd need the chatwoot message ID, but createTextMessage returns it
    // For now we skip explicit mapping as we handle async

    // Mark as read
    await chatwoot.markAsRead(conversation.id);

    console.log(`[Incoming] Message sent to Chatwoot conversation ${conversation.id}`);
  } catch (error) {
    console.error('[Incoming] Error handling message:', error);
  }
}

export async function handleMessageDelete(sock, key) {
  console.log('[Delete] Message deleted:', key.id);
  // Could sync deletion to Chatwoot if needed
}

export async function handleGroupJoin(sock, notification) {
  console.log('[Group] Joined:', notification.id);
}

export async function handleGroupLeave(sock, notification) {
  console.log('[Group] Left:', notification.id);
}
