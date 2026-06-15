class GeminiKeyManager {
    constructor() {
        this.keys = [];
        this.currentIndex = 0; // Se mantiene por retrocompatibilidad, pero no define la llave actual.
        this.COOLDOWN_MS = 30 * 1000; // 30 segundos
        this.currentKeyIndex = 0;

        this.initKeys();
    }

    initKeys() {
        // Cargar claves desde process.env
        const envKeys = [
            process.env.GEMINI_API_KEY,
            process.env.GEMINI_API_KEY_1,
            process.env.GEMINI_API_KEY_2,
            process.env.GEMINI_API_KEY_3,
            process.env.GEMINI_API_KEY_4,
            process.env.GEMINI_API_KEY_5
        ];

        let idCounter = 1;
        for (const key of envKeys) {
            if (key && typeof key === 'string' && key.trim().length > 0) {
                if (!this.keys.some(k => k.value === key.trim())) {
                    this.keys.push({
                        id: `key_${idCounter}`,
                        value: key.trim(),
                        display: `***${key.trim().slice(-4)}`,
                        status: 'active', // 'active' | 'cooldown'
                        cooldownUntil: null,
                        requests: 0,
                        errors: 0,
                        quotaFailures: 0,
                        totalResponseTime: 0,
                        averageResponseTime: 0,
                        healthScore: 100, // Comienza sano
                        lastUsed: null
                    });
                    idCounter++;
                }
            }
        }

        if (this.keys.length === 0) {
            console.warn('[SmartGeminiPoolManager] No se encontraron claves API de Gemini en process.env.');
        } else {
            console.log(`[SmartGeminiPoolManager] Inicializado con ${this.keys.length} claves.`);
        }
    }

    _refreshCooldowns() {
        const now = Date.now();
        for (const key of this.keys) {
            // Recuperar salud pasivamente
            if (key.healthScore < 100 && key.status === 'active') {
                if (!key.lastUsed || (now - new Date(key.lastUsed).getTime() > 30000)) {
                    key.healthScore = Math.min(100, key.healthScore + 2); // Regenera lento
                }
            }

            if (key.status === 'cooldown' && key.cooldownUntil && now > key.cooldownUntil) {
                key.status = 'active';
                key.cooldownUntil = null;
                // Reintroduce con salud base para que gane confianza de nuevo
                key.healthScore = Math.max(50, key.healthScore);
                console.log(`[SmartGeminiPoolManager] Clave ${key.display} se ha recuperado del cooldown. Health: ${key.healthScore}`);
            }
        }
    }

    getAvailableKeys() {
        this._refreshCooldowns();
        return this.keys.filter(k => k.status === 'active' && k.healthScore >= 0);
    }

    getCurrentKey() {
        let availableKeys = this.getAvailableKeys();
        
        // Si todas las claves están agotadas, forzamos recuperación reactivando todo
        if (availableKeys.length === 0 && this.keys.length > 0) {
            console.warn('[SmartGeminiPoolManager] Todas las claves en cooldown. Forzando reactivación.');
            for (const key of this.keys) {
                key.status = 'active';
                key.cooldownUntil = null;
                key.healthScore = Math.max(20, key.healthScore); // Mínimo necesario
            }
            availableKeys = this.keys;
        }

        if (availableKeys.length === 0) {
            return null; // No hay claves configuradas
        }

        // Ordenamos por Health Score descendente y luego por latencia media
        availableKeys.sort((a, b) => {
            if (b.healthScore !== a.healthScore) {
                return b.healthScore - a.healthScore; // Mayor score primero
            }
            return a.averageResponseTime - b.averageResponseTime; // Menor latencia primero
        });

        const bestKey = availableKeys[0];
        bestKey.requests++;
        bestKey.lastUsed = new Date().toISOString();
        
        // Mantener compatibilidad de índice (aunque ya no sea round-robin)
        this.currentKeyIndex = this.keys.findIndex(k => k.value === bestKey.value);
        return bestKey;
    }

    // Compatibilidad para sistemas viejos
    rotateKey() {
        // En un Smart Pool la rotación es automática por degradación del score.
        // Pero proveemos la función por compatibilidad estricta.
    }

    markKeyAsFailed(keyObj) {
        this.recordError(keyObj, 'quota'); // Asumimos que los viejos failed eran por cuota
    }

    recordSuccess(keyObj, latencyMs) {
        if (!keyObj) return;
        const key = this.keys.find(k => k.value === keyObj.value);
        if (key) {
            key.totalResponseTime += latencyMs;
            // Promedio simple
            key.averageResponseTime = Math.round(key.totalResponseTime / key.requests);
            // Sube un poquito la salud
            key.healthScore = Math.min(100, key.healthScore + 1);
        }
    }

    recordError(keyObj, errorType = 'general') {
        if (!keyObj) return;
        const key = this.keys.find(k => k.value === keyObj.value);
        if (key) {
            if (errorType === 'quota') {
                key.quotaFailures++;
                key.healthScore -= 50;
                key.status = 'cooldown';
                key.cooldownUntil = Date.now() + this.COOLDOWN_MS;
                console.warn(`[SmartGeminiPoolManager] Clave ${key.display} CUOTA SUPERADA. Penalización severa. Health: ${key.healthScore}`);
            } else {
                key.errors++;
                key.healthScore -= 15;
                console.warn(`[SmartGeminiPoolManager] Clave ${key.display} falló (Error). Health bajó a: ${key.healthScore}`);
                
                // Si la llave está muy dañada, va a cuarentena
                if (key.healthScore < 0) {
                    key.status = 'cooldown';
                    key.cooldownUntil = Date.now() + (this.COOLDOWN_MS / 2); // 15 segs
                }
            }
        }
    }

    getStatus() {
        this._refreshCooldowns();
        return {
            poolSize: this.keys.length,
            activeKeys: this.keys.filter(k => k.status === 'active').length,
            cooldownKeys: this.keys.filter(k => k.status === 'cooldown').length,
            keys: this.keys.map(k => ({
                id: k.id,
                display: k.display,
                status: k.status,
                healthScore: k.healthScore,
                requests: k.requests,
                errors: k.errors,
                quotaFailures: k.quotaFailures,
                averageResponseTime: k.averageResponseTime,
                lastUsed: k.lastUsed,
                cooldownRemainingMs: k.cooldownUntil ? Math.max(0, k.cooldownUntil - Date.now()) : 0
            }))
        };
    }
}

const geminiKeyManager = new GeminiKeyManager();
module.exports = geminiKeyManager;
