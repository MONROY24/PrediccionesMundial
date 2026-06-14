const fs = require('fs');
const path = require('path');

export default async function handler(req, res) {
    // Habilitar CORS
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        return res.status(200).end();
    }
    
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');

    const MAX_LOGS = 500;
    
    async function getLogs() {
        // 1. Intentar Vercel KV / Redis URL
        if (process.env.REDIS_URL) {
            try {
                const Redis = require('ioredis');
                const client = new Redis(process.env.REDIS_URL);
                const dataStr = await client.get('gemini_audit_logs');
                await client.quit();
                if (dataStr) {
                    const data = JSON.parse(dataStr);
                    return Array.isArray(data) ? data : [];
                }
            } catch (e) {
                console.warn('[Audit API] Fallo al leer de REDIS_URL:', e.message);
            }
        } else if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
            try {
                const { kv } = require('@vercel/kv');
                const data = await kv.get('gemini_audit_logs');
                if (data) return Array.isArray(data) ? data : [];
            } catch (e) {
                console.warn('[Audit API] Fallo al leer de Vercel KV:', e.message);
            }
        }

        // 2. Intentar FS local o /tmp
        const isVercel = process.env.VERCEL === '1';
        const filePath = isVercel 
            ? '/tmp/audit.json' 
            : path.join(process.cwd(), 'data', 'audit', 'audit.json');

        try {
            if (fs.existsSync(filePath)) {
                const content = fs.readFileSync(filePath, 'utf8');
                return JSON.parse(content);
            }
        } catch (e) {
            console.warn('[Audit API] Fallo al leer de FS:', e.message);
        }

        return [];
    }

    async function saveLogs(logs) {
        // 1. Intentar Vercel KV / Redis URL
        if (process.env.REDIS_URL) {
            try {
                const Redis = require('ioredis');
                const client = new Redis(process.env.REDIS_URL);
                await client.set('gemini_audit_logs', JSON.stringify(logs));
                await client.quit();
                return;
            } catch (e) {
                console.warn('[Audit API] Fallo al escribir en REDIS_URL:', e.message);
            }
        } else if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
            try {
                const { kv } = require('@vercel/kv');
                await kv.set('gemini_audit_logs', logs);
                return; // Priorizamos KV si funcionó
            } catch (e) {
                console.warn('[Audit API] Fallo al escribir en Vercel KV:', e.message);
            }
        }

        // 2. Intentar FS local o /tmp
        const isVercel = process.env.VERCEL === '1';
        const dirPath = isVercel ? '/tmp' : path.join(process.cwd(), 'data', 'audit');
        const filePath = path.join(dirPath, 'audit.json');

        try {
            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
            }
            fs.writeFileSync(filePath, JSON.stringify(logs, null, 2));
        } catch (e) {
            console.warn('[Audit API] Fallo al escribir en FS:', e.message);
        }
    }

    if (req.method === 'GET') {
        const logs = await getLogs();
        return res.status(200).json({ success: true, count: logs.length, data: logs });
    }

    if (req.method === 'POST') {
        try {
            const auditData = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            
            if (!auditData || !auditData.timestamp) {
                return res.status(400).json({ error: 'Payload de auditoría inválido' });
            }

            let logs = await getLogs();
            logs.push(auditData);

            if (logs.length > MAX_LOGS) {
                logs = logs.slice(logs.length - MAX_LOGS);
            }

            await saveLogs(logs);

            return res.status(200).json({ success: true, message: 'Auditoría registrada correctamente' });
        } catch (e) {
            console.error('[Audit API] POST Error:', e);
            return res.status(500).json({ error: 'Error interno guardando auditoría', details: e.message });
        }
    }

    return res.status(405).json({ error: 'Método no permitido. Use GET o POST.' });
}
