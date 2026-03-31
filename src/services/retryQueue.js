import Redis from 'ioredis';
import { config } from '../config.js';

const RETRY_QUEUE_KEY = 'chatwoot:retry:queue';
const RETRY_PROCESSED_KEY = 'chatwoot:retry:processed';
const MAX_RETRIES = 5;
const RETRY_DELAYS = [1000, 5000, 15000, 30000, 60000]; // 1s, 5s, 15s, 30s, 1min

class RetryQueue {
  constructor() {
    this.redis = null;
    this.isConnected = false;
    this.processorInterval = null;
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
      console.log('[Redis] Connected successfully');

      // Handle errors
      this.redis.on('error', (err) => {
        console.error('[Redis] Error:', err.message);
        this.isConnected = false;
      });

      this.redis.on('close', () => {
        console.log('[Redis] Connection closed');
        this.isConnected = false;
      });

      // Start processor
      this.startProcessor();

      return true;
    } catch (error) {
      console.error('[Redis] Connection failed:', error.message);
      this.isConnected = false;
      return false;
    }
  }

  async add(message, priority = 0) {
    if (!this.isConnected) {
      console.warn('[RetryQueue] Redis not connected, skipping queue');
      return false;
    }

    try {
      const job = {
        id: `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        data: message,
        attempts: 0,
        createdAt: Date.now(),
        priority
      };

      // Add to sorted set with score = priority + timestamp
      const score = priority * 10000000000 + Date.now();
      await this.redis.zadd(RETRY_QUEUE_KEY, score, JSON.stringify(job));

      console.log(`[RetryQueue] Added job ${job.id} (priority: ${priority})`);
      return true;
    } catch (error) {
      console.error('[RetryQueue] Error adding job:', error.message);
      return false;
    }
  }

  async processJob() {
    if (!this.isConnected) return null;

    try {
      // Get job with lowest score (highest priority + oldest)
      const jobs = await this.redis.zrange(RETRY_QUEUE_KEY, 0, 0);
      
      if (jobs.length === 0) return null;

      const job = JSON.parse(jobs[0]);
      
      // Check if should process now
      const delay = RETRY_DELAYS[job.attempts] || RETRY_DELAYS[RETRY_DELAYS.length - 1];
      const shouldProcess = Date.now() - job.createdAt >= delay;

      if (!shouldProcess) return null;

      // Remove from queue
      await this.redis.zrem(RETRY_QUEUE_KEY, jobs[0]);

      return job;
    } catch (error) {
      console.error('[RetryQueue] Error processing job:', error.message);
      return null;
    }
  }

  async markSuccess(job) {
    if (!this.isConnected) return;

    try {
      // Add to processed set with TTL (24 hours)
      await this.redis.setex(
        `${RETRY_PROCESSED_KEY}:${job.id}`,
        86400,
        JSON.stringify({ ...job, processedAt: Date.now() })
      );
      console.log(`[RetryQueue] Job ${job.id} marked as success`);
    } catch (error) {
      console.error('[RetryQueue] Error marking success:', error.message);
    }
  }

  async markFailed(job) {
    if (!this.isConnected) return;

    try {
      job.attempts++;
      
      if (job.attempts >= MAX_RETRIES) {
        console.error(`[RetryQueue] Job ${job.id} permanently failed after ${job.attempts} attempts`);
        // Could notify here or move to dead letter queue
        return;
      }

      // Re-add to queue with same priority
      const score = job.priority * 10000000000 + Date.now();
      await this.redis.zadd(RETRY_QUEUE_KEY, score, JSON.stringify(job));
      
      console.log(`[RetryQueue] Job ${job.id} failed, retry ${job.attempts}/${MAX_RETRIES}`);
    } catch (error) {
      console.error('[RetryQueue] Error marking failed:', error.message);
    }
  }

  async getQueueSize() {
    if (!this.isConnected) return -1;
    return await this.redis.zcard(RETRY_QUEUE_KEY);
  }

  startProcessor() {
    if (this.processorInterval) return;

    this.processorInterval = setInterval(async () => {
      const job = await this.processJob();
      
      if (job) {
        try {
          // Execute the job (call Chatwoot API)
          const result = await this.executeJob(job);
          
          if (result.success) {
            await this.markSuccess(job);
          } else {
            await this.markFailed(job);
          }
        } catch (error) {
          console.error(`[RetryQueue] Job execution error:`, error.message);
          await this.markFailed(job);
        }
      }
    }, 1000); // Check every second
  }

  async executeJob(job) {
    // This will be called with the actual Chatwoot API call
    // The handler will provide this function
    return { success: true };
  }

  setExecutor(executorFn) {
    this.executeJob = executorFn;
  }

  stop() {
    if (this.processorInterval) {
      clearInterval(this.processorInterval);
      this.processorInterval = null;
    }
    if (this.redis) {
      this.redis.disconnect();
    }
  }
}

export const retryQueue = new RetryQueue();
export default retryQueue;
