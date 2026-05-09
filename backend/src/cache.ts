// Multi-method in-memory cache with TTL

interface CacheEntry {
  data: any;
  timestamp: number | null;
}

interface CacheResult {
  data: any;
  age: number;
  cachedAt: string;
}

class Cache {
  private caches: Record<string, CacheEntry>;
  private ttlMs: number;

  constructor() {
    this.caches = {
      ict: { data: null, timestamp: null },
      kim_nghia: { data: null, timestamp: null }
    };
    this.ttlMs = 20 * 60 * 1000; // 20 minutes (longer than 15min schedule + buffer)
  }

  setMethod(methodId: string, data: any): void {
    this.caches[methodId] = {
      data,
      timestamp: Date.now()
    };
    console.log(`[Cache][${methodId}] Data cached at ${new Date().toISOString()}`);
  }

  getMethod(methodId: string): CacheResult | null {
    const cache = this.caches[methodId];
    if (!cache || !cache.data || !cache.timestamp) return null;
    
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

  getAllMethods(): Record<string, CacheResult> {
    const result: Record<string, CacheResult> = {};
    for (const [methodId, _cache] of Object.entries(this.caches)) {
      const cached = this.getMethod(methodId);
      if (cached) {
        result[methodId] = cached;
      }
    }
    return result;
  }

  // Keep existing set/get for backward compatibility (defaults to 'ict')
  set(data: any): void { this.setMethod('ict', data); }
  
  get(): CacheResult | null { return this.getMethod('ict'); }

  isValid(): boolean {
    return this.get() !== null;
  }
}

export const cache = new Cache();
