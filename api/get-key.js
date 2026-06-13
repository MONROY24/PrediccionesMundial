module.exports = (req, res) => {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
        return res.status(503).json({ error: 'API Key no configurada' });
    }
    return res.status(200).json({ key });
};
