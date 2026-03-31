import { readFileSync, writeFile, existsSync } from 'fs';
import { dirname } from 'path';
import { mkdirSync } from 'fs';

const STATE_FILE = './data/state.json';

class State {
  constructor() {
    this.conversations = new Map(); // waJid -> chatwootConversationId
    this.waToCw = new Map(); // waMsgId -> { cwMsgId, conversationId, direction }
    this.cwToWa = new Map(); // cwMsgId -> waMsgId
    this.contacts = new Map(); // waJid -> { name, notify, verifiedName }
    this._saveTimeout = null;
    this.load();
  }

  load() {
    try {
      if (existsSync(STATE_FILE)) {
        const data = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
        
        if (data.conversations) {
          this.conversations = new Map(Object.entries(data.conversations));
        }
        if (data.waToCw) {
          this.waToCw = new Map(Object.entries(data.waToCw).map(([k, v]) => [k, new Map(Object.entries(v))]));
        }
        if (data.cwToWa) {
          this.cwToWa = new Map(Object.entries(data.cwToWa));
        }
        if (data.contacts) {
          this.contacts = new Map(Object.entries(data.contacts));
        }
        
        console.log('[State] Loaded from file');
      }
    } catch (error) {
      console.error('[State] Error loading:', error);
    }
  }

  save() {
    // Debounce: save max once per second
    if (this._saveTimeout) return;

    this._saveTimeout = setTimeout(async () => {
      try {
        mkdirSync(dirname(STATE_FILE), { recursive: true });

        const data = {
          conversations: Object.fromEntries(this.conversations),
          waToCw: Object.fromEntries([...this.waToCw.entries()].map(([k, v]) => [k, Object.fromEntries(v)])),
          cwToWa: Object.fromEntries(this.cwToWa),
          contacts: Object.fromEntries(this.contacts)
        };

        await writeFile(STATE_FILE, JSON.stringify(data));
      } catch (error) {
        console.error('[State] Error saving:', error);
      } finally {
        this._saveTimeout = null;
      }
    }, 1000);
  }

  // Conversation methods
  setConversation(waJid, cwConvId) {
    this.conversations.set(waJid, cwConvId);
    this.save();
  }

  getConversation(waJid) {
    return this.conversations.get(waJid);
  }

  getJidFromConversation(cwConvId) {
    for (const [jid, convId] of this.conversations.entries()) {
      if (convId === cwConvId) return jid;
    }
    return null;
  }

  // Message mapping
  mapMessage(waMsgId, cwMsgId, conversationId, direction = 'incoming') {
    this.waToCw.set(waMsgId, { cwMsgId, conversationId, direction });
    this.cwToWa.set(cwMsgId, waMsgId);
    this.save();
  }

  getByWaMsgId(waMsgId) {
    return this.waToCw.get(waMsgId);
  }

  getByCwMsgId(cwMsgId) {
    return this.cwToWa.get(cwMsgId);
  }

  // Contact methods
  setContact(jid, info) {
    this.contacts.set(jid, {
      ...info,
      updatedAt: Date.now()
    });
    this.save();
  }

  getContact(jid) {
    return this.contacts.get(jid);
  }

  getOrCreateContact(jid, info = {}) {
    const existing = this.contacts.get(jid);
    if (existing) return existing;
    
    const contact = {
      jid,
      name: info.name || info.notify || jid.split('@')[0],
      verifiedName: info.verifiedName || '',
      updatedAt: Date.now()
    };
    
    this.contacts.set(jid, contact);
    this.save();
    return contact;
  }

  // Cleanup
  clear() {
    this.conversations.clear();
    this.waToCw.clear();
    this.cwToWa.clear();
    this.contacts.clear();
    this.save();
  }
}

export const state = new State();
export default state;
