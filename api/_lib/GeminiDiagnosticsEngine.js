const fs = require('fs');
const path = require('path');

class GeminiDiagnosticsEngine {
    static getFsPath() {
        const isVercel = process.env.VERCEL === '1';
        return isVercel 
            ? '/tmp/gemini_diagnostics.json' 
            : path.join(process.cwd(), 'data', 'logs', 'diagnostics.json');
    }

    static async recordDiagnostic(diagnosticObj) {
        try {
            const logPath = this.getFsPath();
            let logs = [];
            if (fs.existsSync(logPath)) {
                try {
                    logs = JSON.parse(fs.readFileSync(logPath, 'utf8'));
                } catch(e) {}
            }
            logs.unshift(diagnosticObj);
            if (logs.length > 500) logs = logs.slice(0, 500); // keep last 500
            
            const dir = path.dirname(logPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(logPath, JSON.stringify(logs));
        } catch(e) {
            console.error('[Diagnostics] Failed to record:', e.message);
        }
    }

    static async getDiagnostics() {
        try {
            const logPath = this.getFsPath();
            if (fs.existsSync(logPath)) {
                return JSON.parse(fs.readFileSync(logPath, 'utf8'));
            }
        } catch(e) {}
        return [];
    }

    static async getAggregatedMetrics() {
        const logs = await this.getDiagnostics();
        if (logs.length === 0) return {
            totalRequests: 0,
            averageResponseTime: 0,
            errorRate: 0,
            usageByModel: {},
            usageByKey: {},
            cacheHitRate: 0
        };

        let totalTime = 0;
        let errors = 0;
        let cacheHits = 0;
        let usageByModel = {};
        let usageByKey = {};

        logs.forEach(log => {
            const time = parseInt(log.responseTime) || 0;
            totalTime += time;
            if (log.status !== 'SUCCESS') errors++;
            if (log.cacheHit) cacheHits++;
            
            const model = log.model || 'unknown';
            usageByModel[model] = (usageByModel[model] || 0) + 1;
            
            const key = log.apiKeyIndex !== undefined ? log.apiKeyIndex : 'unknown';
            usageByKey[key] = (usageByKey[key] || 0) + 1;
        });

        return {
            totalRequests: logs.length,
            averageResponseTime: Math.round(totalTime / logs.length),
            errorRate: Math.round((errors / logs.length) * 100),
            usageByModel,
            usageByKey,
            cacheHitRate: Math.round((cacheHits / logs.length) * 100)
        };
    }
}

module.exports = GeminiDiagnosticsEngine;
