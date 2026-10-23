interface CacheResult {
    data: any;
    age: number;
    cachedAt: string;
}
declare class Cache {
    private caches;
    private ttlMs;
    constructor();
    setMethod(methodId: string, data: any): void;
    getMethod(methodId: string): CacheResult | null;
    getAllMethods(): Record<string, CacheResult>;
    set(data: any): void;
    get(): CacheResult | null;
    isValid(): boolean;
}
export declare const cache: Cache;
export {};
//# sourceMappingURL=cache.d.ts.map