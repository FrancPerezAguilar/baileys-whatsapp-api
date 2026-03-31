import Redis from 'ioredis';
import { config } from '../config.js';

const DEFAULT_TTL = 3600; // 1 hour

class Cache {
  constructor() {
    this.redis = null;
    this.isConnected = false;
    this.prefix = 'baileys:';
  }

  async connect() {
    try {
      this.redis = new Redis({
        host: config.redis.host,
        port: config.redis.port,
        password: config.redis.password || undefined,
        maxRetriesPerRequest: 3,
        lazyConnect: true
      });

      await this.redis.connect();
      this.isConnected = true;
      console.log('[Cache] Redis connected successfully');
      return true;
    } catch (error) {
      console.error('[Cache] Redis connection failed:', error.message);
      this.isConnected = false;
      return false;
    }
  }

  getClient() {
    return this.redis;
  }

  isReady() {
    return this.isConnected;
  }

  async get(key) {
    if (!this.isConnected) return null;

    try {
      const value = await this.redis.get(`${this.prefix}${key}`);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      console.error('[Cache] Get error:', error.message);
      return null;
    }
  }

  async set(key, value, ttl = DEFAULT_TTL) {
    if (!this.isConnected) return false;

    try {
      await this.redis.setex(
        `${this.prefix}${key}`,
        ttl,
        JSON.stringify(value)
      );
      return true;
    } catch (error) {
      console.error('[Cache] Set error:', error.message);
      return false;
    }
  }

  async del(key) {
    if (!this.isConnected) return false;

    try {
      await this.redis.del(`${this.prefix}${key}`);
      return true;
    } catch (error) {
      console.error('[Cache] Del error:', error.message);
      return false;
    }
  }

  async exists(key) {
    if (!this.isConnected) return false;

    try {
      return await this.redis.exists(`${this.prefix}${key}`) === 1;
    } catch (error) {
      console.error('[Cache] Exists error:', error.message);
      return false;
    }
  }

  // Specific cache methods for the bridge

  // Cache conversation ID to avoid repeated lookups
  async getConversationJid(cwConvId) {
    return await this.get(`conv:${cwConvId}`);
  }

  async setConversationJid(cwConvId, waJid, ttl = 86400) {
    await this.set(`conv:${cwConvId}`, waJid, ttl);
  }

  // Cache message mapping
  async getWaMsgId(cwMsgId) {
    return await this.get(`msg:cw:${cwMsgId}`);
  }

  async setWaMsgId(cwMsgId, waMsgId, ttl = 604800) { // 7 days
    await this.set(`msg:cw:${cwMsgId}`, waMsgId, ttl);
  }

  async getCwMsgId(waMsgId) {
    return await this.get(`msg:wa:${waMsgId}`);
  }

  async setCwMsgId(waMsgId, cwMsgId, ttl = 604800) {
    await this.set(`msg:wa:${waMsgId}`, cwMsgId, ttl);
  }

  // Rate limiting (atomic with Lua script)
  async rateLimit(key, limit, window) {
    if (!this.isConnected) return { allowed: true, remaining: limit };

    const rateKey = `${this.prefix}ratelimit:${key}`;

    const luaScript = `
      local current = redis.call('INCR', KEYS[1])
      if current == 1 then
        redis.call('EXPIRE', KEYS[1], ARGV[1])
      end
      return current
    `;

    try {
      const current = await this.redis.eval(luaScript, 1, rateKey, window);
      const ttl = await this.redis.ttl(rateKey);

      return {
        allowed: current <= limit,
        remaining: Math.max(0, limit - current),
        resetIn: ttl
      };
    } catch (error) {
      console.error('[Cache] Rate limit error:', error.message);
      return { allowed: true, remaining: limit };
    }
  }

  // Contact cache
  async getContact(jid) {
    return await this.get(`contact:${jid}`);
  }

  async setContact(jid, contact, ttl = 3600) {
    await this.set(`contact:${jid}`, contact, ttl);
  }

  stop() {
    if (this.redis) {
      this.redis.disconnect();
    }
  }
}

export const cache = new Cache();
export default cache;
