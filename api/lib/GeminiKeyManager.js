class GeminiKeyManager {
    constructor() {
        this.keys = [];
        this.currentIndex = 0;
        this.COOLDOWN_MS = 5 * 60 * 1000; // 5 minutos de cooldown

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
                // Evitar duplicados si GEMINI_API_KEY es la misma que GEMINI_API_KEY_1
                if (!this.keys.some(k => k.value === key.trim())) {
                    this.keys.push({
                        id: `key_${idCounter}`,
                        value: key.trim(),
                        display: `***${key.trim().slice(-4)}`, // Mostrar solo últimos 4 dígitos
                        status: 'active', // 'active' | 'cooldown'
                        cooldownUntil: null,
                        requests: 0,
                        errors: 0,
                        lastUsed: null
                    });
                    idCounter++;
                }
            }
        }

        if (this.keys.length === 0) {
            console.warn('[GeminiKeyManager] No se encontraron claves API de Gemini en process.env.');
        } else {
            console.log(`[GeminiKeyManager] Inicializado con ${this.keys.length} claves.`);
        }
    }

    _refreshCooldowns() {
        const now = Date.now();
        for (const key of this.keys) {
            if (key.status === 'cooldown' && key.cooldownUntil && now > key.cooldownUntil) {
                key.status = 'active';
                key.cooldownUntil = null;
                console.log(`[GeminiKeyManager] Clave ${key.display} se ha recuperado del cooldown.`);
            }
        }
    }

    getAvailableKeys() {
        this._refreshCooldowns();
        return this.keys.filter(k => k.status === 'active');
    }

    getCurrentKey() {
        const availableKeys = this.getAvailableKeys();
        if (availableKeys.length === 0) {
            return null; // Todas están agotadas o no hay claves
        }

        // Si currentIndex apunta a una clave agotada, buscar la siguiente válida
        let iterations = 0;
        while (iterations < this.keys.length) {
            const candidate = this.keys[this.currentIndex];
            if (candidate.status === 'active') {
                candidate.requests++;
                candidate.lastUsed = new Date().toISOString();
                return candidate;
            }
            this.rotateKey();
            iterations++;
        }

        return null;
    }

    rotateKey() {
        if (this.keys.length > 0) {
            this.currentIndex = (this.currentIndex + 1) % this.keys.length;
        }
    }

    markKeyAsFailed(keyObj) {
        if (!keyObj) return;
        const key = this.keys.find(k => k.value === keyObj.value);
        if (key) {
            key.errors++;
            key.status = 'cooldown';
            key.cooldownUntil = Date.now() + this.COOLDOWN_MS;
            console.warn(`[GeminiKeyManager] Clave ${key.display} marcada como FAILED. Cooldown hasta ${new Date(key.cooldownUntil).toISOString()}`);
            this.rotateKey(); // Cambiar índice a la siguiente para la próxima petición
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
                requests: k.requests,
                errors: k.errors,
                lastUsed: k.lastUsed,
                cooldownRemainingMs: k.cooldownUntil ? Math.max(0, k.cooldownUntil - Date.now()) : 0
            }))
        };
    }
}

// Singleton export
const geminiKeyManager = new GeminiKeyManager();
module.exports = geminiKeyManager;
