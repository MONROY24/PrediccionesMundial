const GeminiStatus = {
    SUCCESS: 'SUCCESS',
    TIMEOUT: 'TIMEOUT',
    QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
    RATE_LIMIT: 'RATE_LIMIT',
    INVALID_RESPONSE: 'INVALID_RESPONSE',
    MODEL_ERROR: 'MODEL_ERROR',
    MODEL_NOT_FOUND: 'MODEL_NOT_FOUND',
    COMPATIBILITY_ERROR: 'COMPATIBILITY_ERROR'
};

const DEFAULT_CONFIG = {
    REQUEST_TIMEOUT_MS: 10000,
    MAX_RETRIES: 3
};

class GeminiReliabilityEngine {
    /**
     * Executes a robust Gemini request with retries, timeout, and fallback handling.
     * @param {Function} requestProvider - async (attempt, lastStatus, lastError) => { url, body, model }
     * @param {Object} config - Configuration options (e.g. { REQUEST_TIMEOUT_MS, MAX_RETRIES })
     * @returns {Promise<Object>} { status, text, data, sources, finishReason, error, latency, modelUsed, toolsUsed }
     */
    static async executeGeminiRequest(requestProvider, config = {}) {
        const timeoutMs = config.REQUEST_TIMEOUT_MS || DEFAULT_CONFIG.REQUEST_TIMEOUT_MS;
        const maxRetries = config.MAX_RETRIES || DEFAULT_CONFIG.MAX_RETRIES;
        
        let attempts = 0;
        let lastStatus = GeminiStatus.MODEL_ERROR;
        let lastError = null;

        while (attempts < maxRetries) {
            attempts++;
            
            // Allow the provider to rotate keys, disable grounding, or even abort
            const req = await requestProvider(attempts, lastStatus, lastError);
            if (!req) {
                console.warn(`[GeminiReliabilityEngine] requestProvider aborted on attempt ${attempts}`);
                break; 
            }
            const { url, body, model } = req;
            const toolsUsed = body.tools ? body.tools.map(t => Object.keys(t)[0]) : [];
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
            
            const startTime = Date.now();
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                    signal: controller.signal
                });
                
                const latency = Date.now() - startTime;
                clearTimeout(timeoutId);
                const data = await response.json();
                
                if (!response.ok) {
                    const errCode = data.error?.code || response.status;
                    const errMsg = data.error?.message || 'Unknown error';
                    const httpStatus = response.status;
                    
                    const isQuotaError = errCode === 429 || String(errCode) === '429' ||
                                         String(httpStatus) === '429' ||
                                         errMsg.toLowerCase().includes('quota') || 
                                         errMsg.toLowerCase().includes('exhausted') ||
                                         errMsg.toLowerCase().includes('rate limit');
                    
                    const isOverloadError = httpStatus === 503 || String(errCode) === '503' ||
                                            errMsg.toLowerCase().includes('high demand') || 
                                            errMsg.toLowerCase().includes('overloaded') ||
                                            errMsg.toLowerCase().includes('temporarily unavailable');

                    const isNotFoundError = httpStatus === 404 || String(errCode) === '404' ||
                                            errMsg.toLowerCase().includes('not found');

                    const isCompatError = httpStatus === 400 || String(errCode) === '400';
                    
                    if (isNotFoundError) {
                        lastStatus = GeminiStatus.MODEL_NOT_FOUND;
                    } else if (isCompatError) {
                        lastStatus = GeminiStatus.COMPATIBILITY_ERROR;
                    } else if (isQuotaError) {
                        lastStatus = GeminiStatus.QUOTA_EXCEEDED;
                    } else if (isOverloadError) {
                        lastStatus = GeminiStatus.RATE_LIMIT;
                    } else {
                        lastStatus = GeminiStatus.MODEL_ERROR;
                    }
                    
                    lastError = new Error(`HTTP ${httpStatus}: ${errMsg}`);
                    console.warn(`[GeminiReliabilityEngine] Attempt ${attempts} failed: ${lastStatus} - ${errMsg} (${latency}ms)`);
                    continue; // Loop retry
                }
                
                // Parse standard Gemini response
                const textChunk = data.candidates?.[0]?.content?.parts?.[0]?.text;
                const finishReason = data.candidates?.[0]?.finishReason;
                
                if (finishReason === 'MALFORMED_FUNCTION_CALL' && !textChunk) {
                    lastStatus = GeminiStatus.INVALID_RESPONSE;
                    lastError = new Error('MALFORMED_FUNCTION_CALL');
                    console.warn(`[GeminiReliabilityEngine] Attempt ${attempts} failed: ${lastStatus} (${latency}ms)`);
                    continue;
                }
                
                if (!textChunk && finishReason !== 'MAX_TOKENS') {
                    lastStatus = GeminiStatus.INVALID_RESPONSE;
                    lastError = new Error(`Empty response with reason: ${finishReason || 'unknown'}`);
                    console.warn(`[GeminiReliabilityEngine] Attempt ${attempts} failed: ${lastStatus} (${latency}ms)`);
                    continue;
                }
                
                // Success
                lastStatus = GeminiStatus.SUCCESS;
                console.log(`[GeminiReliabilityEngine] Request successful on attempt ${attempts} (${latency}ms)`);
                
                // Extract Grounding sources if any
                const chunks = data.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
                const sources = chunks.map(chunk => chunk.web?.uri).filter(Boolean);
                
                return {
                    status: GeminiStatus.SUCCESS,
                    data,
                    text: textChunk || '',
                    finishReason: finishReason,
                    sources: sources,
                    error: null,
                    latency,
                    modelUsed: model || 'unknown',
                    toolsUsed,
                    keyObj: req.keyObj
                };

            } catch (err) {
                clearTimeout(timeoutId);
                const latency = Date.now() - startTime;
                if (err.name === 'AbortError') {
                    lastStatus = GeminiStatus.TIMEOUT;
                    lastError = new Error(`Request timed out after ${timeoutMs}ms`);
                    console.warn(`[GeminiReliabilityEngine] Attempt ${attempts} TIMEOUT (${latency}ms)`);
                } else {
                    lastStatus = GeminiStatus.MODEL_ERROR;
                    lastError = err;
                    console.error(`[GeminiReliabilityEngine] Attempt ${attempts} ERROR:`, err.message, `(${latency}ms)`);
                }
            }
        }
        
        console.error(`[GeminiReliabilityEngine] All ${attempts} attempts failed. Final status: ${lastStatus}`);
        return {
            status: lastStatus,
            error: lastError,
            text: '',
            data: null,
            sources: [],
            latency: null,
            modelUsed: null,
            toolsUsed: []
        };
    }
}

module.exports = { GeminiReliabilityEngine, GeminiStatus };
