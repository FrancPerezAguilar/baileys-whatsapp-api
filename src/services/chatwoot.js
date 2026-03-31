import { config } from '../config.js';
import { retryQueue } from './retryQueue.js';
import { cache } from './cache.js';

const { url, apiKey, inboxId } = config.chatwoot;

class ChatwootClient {
  constructor() {
    this.baseUrl = url.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.inboxId = inboxId;
  }

  get headers() {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json'
    };
  }

  async request(method, path, body = null, useRetry = true) {
    const options = {
      method,
      headers: this.headers,
    };
    
    if (body) {
      options.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(`${this.baseUrl}${path}`, options);
      
      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Chatwoot API error: ${response.status} - ${error}`);
      }

      return response.json();
    } catch (error) {
      // If API fails and retry is enabled, queue for retry
      if (useRetry) {
        console.error(`[Chatwoot] Request failed, queuing for retry:`, error.message);
        await retryQueue.add({
          method,
          path,
          body,
          error: error.message,
          timestamp: Date.now()
        }, 0); // priority 0 = normal
      }
      throw error;
    }
  }

  // Contact operations
  async searchContact(identifier) {
    // Check cache first
    const cached = await cache.get(`contact_search:${identifier}`);
    if (cached) {
      console.log(`[Chatwoot] Contact ${identifier} found in cache`);
      return cached;
    }

    const result = await this.request('GET', `/api/v1/contacts/search?q=${encodeURIComponent(identifier)}&fetch_id=true`);
    const contact = result.payload?.contacts?.[0];
    
    if (contact) {
      await cache.set(`contact:${identifier}`, contact, 3600);
    }
    
    return contact;
  }

  async createContact(identifier, name = '', email = '', phone = '') {
    return this.request('POST', '/api/v1/contacts', {
      contact: {
        identifier,
        name,
        email,
        phone_number: phone
      }
    });
  }

  async getContact(id) {
    return this.request('GET', `/api/v1/contacts/${id}`);
  }

  async updateContact(id, data) {
    return this.request('PUT', `/api/v1/contacts/${id}`, { contact: data });
  }

  // Conversation operations
  async createConversation(contactId, inboxIdToUse = null) {
    return this.request('POST', '/api/v1/conversations', {
      conversation: {
        contact_id: contactId,
        inbox_id: inboxIdToUse || this.inboxId
      }
    });
  }

  async getConversation(id) {
    return this.request('GET', `/api/v1/conversations/${id}`);
  }

  async getConversations(contactId) {
    return this.request('GET', `/api/v1/contacts/${contactId}/conversations`);
  }

  async findOrCreateConversation(identifier, name = '') {
    // Check cache first
    const cachedConvId = await cache.getConversationJid(identifier);
    if (cachedConvId) {
      const conv = await this.getConversation(cachedConvId);
      return { conversation: conv, fromCache: true };
    }

    // Try to find existing contact
    let contact = await this.searchContact(identifier);
    
    if (!contact) {
      // Create new contact
      const created = await this.createContact(identifier, name);
      contact = created.payload;
    }

    // Check for existing conversations
    const conversations = await this.getConversations(contact.id);
    
    // Find conversation for this inbox
    const existingConv = conversations.payload?.find(c => c.inbox_id === parseInt(this.inboxId));
    
    if (existingConv) {
      // Cache the mapping
      await cache.setConversationJid(existingConv.id, identifier);
      return { contact, conversation: existingConv };
    }

    // Create new conversation
    const created = await this.createConversation(contact.id);
    
    // Cache the mapping
    await cache.setConversationJid(created.id, identifier);
    
    return { contact, conversation: created };
  }

  // Message operations
  async createMessage(conversationId, message) {
    return this.request('POST', `/api/v1/conversations/${conversationId}/messages`, {
      message: {
        content: message.content,
        message_type: message.messageType || 'incoming',
        content_type: message.contentType || 'text',
        private: message.private || false,
        attachments: message.attachments || []
      }
    });
  }

  async createTextMessage(conversationId, text, messageType = 'incoming') {
    return this.createMessage(conversationId, {
      content: text,
      messageType,
      contentType: 'text'
    });
  }

  // Attachment operations
  async uploadAttachment(buffer, filename, type) {
    const formData = new FormData();
    const blob = new Blob([buffer]);
    formData.append('attachment', blob, filename);
    formData.append('file_type', type);

    try {
      const response = await fetch(`${this.baseUrl}/api/v1/attachments`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: formData
      });

      if (!response.ok) {
        throw new Error(`Attachment upload failed: ${response.status}`);
      }

      return response.json();
    } catch (error) {
      // Queue for retry (without buffer to avoid memory issues)
      await retryQueue.add({
        retryType: 'attachment',
        mediaRef: { filename, mediaType: type },
        error: error.message
      }, 1); // priority 1 = low (attachments less critical)
      throw error;
    }
  }

  // Mark as read
  async markAsRead(conversationId) {
    return this.request('POST', `/api/v1/conversations/${conversationId}/update_last_seen`, null, false); // Don't retry mark as read
  }

  // Get messages
  async getMessages(conversationId) {
    return this.request('GET', `/api/v1/conversations/${conversationId}/messages`);
  }
}

export const chatwoot = new ChatwootClient();
export default chatwoot;
