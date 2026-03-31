import { config } from '../config.js';

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

  async request(method, path, body = null) {
    const options = {
      method,
      headers: this.headers,
    };
    
    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(`${this.baseUrl}${path}`, options);
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Chatwoot API error: ${response.status} - ${error}`);
    }

    return response.json();
  }

  // Contact operations
  async searchContact(identifier) {
    const result = await this.request('GET', `/api/v1/contacts/search?q=${encodeURIComponent(identifier)}&fetch_id=true`);
    return result.payload?.contacts?.[0];
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
      return { contact, conversation: existingConv };
    }

    // Create new conversation
    const created = await this.createConversation(contact.id);
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
  }

  // Mark as read
  async markAsRead(conversationId) {
    return this.request('POST', `/api/v1/conversations/${conversationId}/update_last_seen`);
  }

  // Get messages
  async getMessages(conversationId) {
    return this.request('GET', `/api/v1/conversations/${conversationId}/messages`);
  }
}

export const chatwoot = new ChatwootClient();
export default chatwoot;
