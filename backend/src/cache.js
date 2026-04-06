// Simple in-memory cache with TTL
class Cache {
  constructor() {
    this.data = null;
    this.timestamp = null;
    this.ttlMs = 20 * 60 * 1000; // 20 minutes (longer than 15min schedule + buffer)
  }

  set(data) {
    this.data = data;
    this.timestamp = Date.now();
    console.log(`[Cache] Data cached at ${new Date().toISOString()}`);
  }

  get() {
    if (!this.data || !this.timestamp) return null;
    
    const age = Date.now() - this.timestamp;
    if (age > this.ttlMs) {
      console.log('[Cache] Data expired');
      return null;
    }
    
    return {
      data: this.data,
      age: Math.floor(age / 1000), // seconds
      cachedAt: new Date(this.timestamp).toISOString()
    };
  }

  isValid() {
    return this.get() !== null;
  }
}

export const cache = new Cache();
