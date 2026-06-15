const GeminiDiagnosticsEngine = require('./lib/GeminiDiagnosticsEngine');

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const diagnostics = await GeminiDiagnosticsEngine.getDiagnostics();
        return res.status(200).json({ success: true, logs: diagnostics });
    } catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    }
};
