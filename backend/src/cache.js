// Multi-method in-memory cache with TTL
class Cache {
  constructor() {
    this.caches = {
      ict: { data: null, timestamp: null },
      kim_nghia: { data: null, timestamp: null }
    };
    this.ttlMs = 20 * 60 * 1000; // 20 minutes (longer than 15min schedule + buffer)
  }

  setMethod(methodId, data) {
    this.caches[methodId] = {
      data,
      timestamp: Date.now()
    };
    console.log(`[Cache][${methodId}] Data cached at ${new Date().toISOString()}`);
  }

  getMethod(methodId) {
    const cache = this.caches[methodId];
    if (!cache || !cache.data) return null;
    
    const age = Date.now() - cache.timestamp;
    if (age > this.ttlMs) {
      console.log(`[Cache][${methodId}] Data expired`);
      return null;
    }
    
    return {
      data: cache.data,
      age: Math.floor(age / 1000),
      cachedAt: new Date(cache.timestamp).toISOString()
    };
  }

  getAllMethods() {
    const result = {};
    for (const [methodId, cache] of Object.entries(this.caches)) {
      const cached = this.getMethod(methodId);
      if (cached) {
        result[methodId] = cached;
      }
    }
    return result;
  }

  // Keep existing set/get for backward compatibility (defaults to 'ict')
  set(data) { this.setMethod('ict', data); }
  
  get() { return this.getMethod('ict'); }

  isValid() {
    return this.get() !== null;
  }
}

export const cache = new Cache();
