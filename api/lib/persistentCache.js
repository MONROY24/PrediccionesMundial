const fs = require('fs');
const path = require('path');

let memoryCache = {};
let memoryStats = { hits: 0, misses: 0 };

class PersistentGeminiCache {
    static getActiveProvider() {
        if (process.env.REDIS_URL || process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL) return 'Redis/KV';
        return process.env.VERCEL === '1' ? 'Vercel /tmp FS' : 'Local FS';
    }

    static async getKvClient() {
        try {
            if (process.env.REDIS_URL) {
                const Redis = require('ioredis');
                const client = new Redis(process.env.REDIS_URL);
                return {
                    get: async (k) => {
                        const val = await client.get(k);
                        try { return JSON.parse(val); } catch(e) { return val; }
                    },
                    set: async (k, v, opts) => {
                        const val = typeof v === 'string' ? v : JSON.stringify(v);
                        if (opts && opts.ex) {
                            await client.set(k, val, 'EX', opts.ex);
                        } else {
                            await client.set(k, val);
                        }
                    },
                    incr: async (k) => client.incr(k)
                };
            } else if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
                const { kv } = require('@vercel/kv');
                return kv;
            } else if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
                const { createClient } = require('@vercel/kv');
                return createClient({
                    url: process.env.UPSTASH_REDIS_REST_URL,
                    token: process.env.UPSTASH_REDIS_REST_TOKEN
                });
            }
        } catch (e) {
            console.warn('[Cache] Could not init KV Client:', e.message);
        }
        return null;
    }

    static getFsPath() {
        const isVercel = process.env.VERCEL === '1';
        return isVercel 
            ? '/tmp/gemini_cache.json' 
            : path.join(process.cwd(), 'data', 'cache', 'gemini.json');
    }

    static getFsStatsPath() {
        const isVercel = process.env.VERCEL === '1';
        return isVercel 
            ? '/tmp/gemini_stats.json' 
            : path.join(process.cwd(), 'data', 'cache', 'stats.json');
    }

    static async recordHit() {
        memoryStats.hits++;
        try {
            const kv = await this.getKvClient();
            if (kv) {
                await kv.incr('gemini_cache_hits');
                return;
            }
            const statsPath = this.getFsStatsPath();
            let stats = { hits: 0, misses: 0 };
            if (fs.existsSync(statsPath)) stats = JSON.parse(fs.readFileSync(statsPath, 'utf8'));
            stats.hits++;
            const dir = path.dirname(statsPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(statsPath, JSON.stringify(stats));
        } catch(e) {}
    }

    static async recordMiss() {
        memoryStats.misses++;
        try {
            const kv = await this.getKvClient();
            if (kv) {
                await kv.incr('gemini_cache_misses');
                return;
            }
            const statsPath = this.getFsStatsPath();
            let stats = { hits: 0, misses: 0 };
            if (fs.existsSync(statsPath)) stats = JSON.parse(fs.readFileSync(statsPath, 'utf8'));
            stats.misses++;
            const dir = path.dirname(statsPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(statsPath, JSON.stringify(stats));
        } catch(e) {}
    }

    static async getCachedAnalysis(key) {
        try {
            const kv = await this.getKvClient();
            if (kv) {
                const data = await kv.get(key);
                if (data) {
                    await this.recordHit();
                    return typeof data === 'string' ? JSON.parse(data) : data;
                }
                await this.recordMiss();
                return null;
            }

            const fsPath = this.getFsPath();
            if (fs.existsSync(fsPath)) {
                const cacheMap = JSON.parse(fs.readFileSync(fsPath, 'utf8'));
                const entry = cacheMap[key];
                if (entry && entry.expiresAt > Date.now()) {
                    await this.recordHit();
                    return entry.data;
                }
            }

            if (memoryCache[key] && memoryCache[key].expiresAt > Date.now()) {
                await this.recordHit();
                return memoryCache[key].data;
            }

            await this.recordMiss();
            return null;

        } catch (e) {
            console.error('[Cache] Read error:', e);
            await this.recordMiss();
            return null;
        }
    }

    static async setCachedAnalysis(key, data, ttlHours = 24) {
        try {
            const kv = await this.getKvClient();
            if (kv) {
                await kv.set(key, data, { ex: Math.floor(ttlHours * 3600) });
                return;
            }

            const expiresAt = Date.now() + (ttlHours * 3600 * 1000);
            
            const fsPath = this.getFsPath();
            let cacheMap = {};
            if (fs.existsSync(fsPath)) {
                try { cacheMap = JSON.parse(fs.readFileSync(fsPath, 'utf8')); } catch(e){}
            }
            cacheMap[key] = { data, expiresAt };
            
            // Clean up expired entries in FS to avoid infinite growth
            const now = Date.now();
            for (const k of Object.keys(cacheMap)) {
                if (cacheMap[k].expiresAt < now) delete cacheMap[k];
            }

            const dir = path.dirname(fsPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(fsPath, JSON.stringify(cacheMap));

            // Also set in memory as fallback
            memoryCache[key] = { data, expiresAt };
        } catch (e) {
            console.error('[Cache] Write error:', e);
            // Memory fallback
            const expiresAt = Date.now() + (ttlHours * 3600 * 1000);
            memoryCache[key] = { data, expiresAt };
        }
    }

    static async cacheExists(key) {
        const data = await this.getCachedAnalysis(key);
        return data !== null;
    }

    static async getCacheStats() {
        try {
            const kv = await this.getKvClient();
            if (kv) {
                const hits = await kv.get('gemini_cache_hits') || 0;
                const misses = await kv.get('gemini_cache_misses') || 0;
                return {
                    provider: 'Vercel KV / Upstash Redis',
                    hits: parseInt(hits),
                    misses: parseInt(misses),
                    memoryHits: memoryStats.hits,
                    memoryMisses: memoryStats.misses
                };
            }
            
            const statsPath = this.getFsStatsPath();
            if (fs.existsSync(statsPath)) {
                const stats = JSON.parse(fs.readFileSync(statsPath, 'utf8'));
                return {
                    provider: process.env.VERCEL === '1' ? 'Vercel /tmp FS' : 'Local FS',
                    hits: stats.hits,
                    misses: stats.misses,
                    memoryHits: memoryStats.hits,
                    memoryMisses: memoryStats.misses
                };
            }

        } catch (e) {}

        return {
            provider: 'Memory',
            hits: memoryStats.hits,
            misses: memoryStats.misses,
            memoryHits: memoryStats.hits,
            memoryMisses: memoryStats.misses
        };
    }
}

module.exports = PersistentGeminiCache;
