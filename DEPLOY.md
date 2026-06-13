# 🚀 Guía de Despliegue — Predictor Mundial 2026 v6.0

## Paso 1 — Configurar Gemini API Key en Vercel

Esta es la única variable **requerida** para el análisis IA.

1. Ve a [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. Genera una nueva API Key
3. En tu proyecto de Vercel → **Settings → Environment Variables**
4. Agrega:
   - **Name**: `GEMINI_API_KEY`
   - **Value**: tu API key
   - **Environments**: Production + Preview + Development

> ⚠️ **IMPORTANTE**: La key que compartiste en el chat puede estar comprometida. Genera una nueva en Google AI Studio antes de desplegar.

---

## Paso 2 — Despliegue básico (sin Vercel KV)

```bash
# Desde la raíz del proyecto:
git add .
git commit -m "feat: v6.0 — Gemini AI + Live Data + Shared Learning"
git push origin main
```

Vercel detectará automáticamente los archivos en `api/` como Serverless Functions.

**Verificaciones post-despliegue:**
- [ ] `https://tu-dominio.vercel.app/` carga correctamente
- [ ] Predictor tab funciona igual que antes
- [ ] Tab "🤖 Análisis IA" aparece en la navegación
- [ ] Al ejecutar una predicción, el análisis IA aparece (~10-15 segundos)
- [ ] `/api/analyze` responde con `{ "success": true }`
- [ ] `/api/model-state` responde con estado del modelo

---

## Paso 3 (Opcional) — Habilitar Aprendizaje Compartido (Vercel KV)

Sin Vercel KV, cada usuario tiene su modelo local independiente.
Con Vercel KV, **todos los usuarios alimentan el mismo modelo**.

1. Ve a tu proyecto en [vercel.com](https://vercel.com)
2. **Storage** → **Create Database** → **KV (Redis)**
3. Dale un nombre (ej: `wc2026-learning`)
4. Haz clic en **Connect to Project**
5. Vercel agrega automáticamente `KV_REST_API_URL` y `KV_REST_API_TOKEN`
6. Redeploy: `git commit --allow-empty -m "chore: enable KV" && git push`

**Verificación:**
- [ ] `/api/model-state` devuelve `"storageMode": "vercel_kv"`
- [ ] Al guardar un resultado, aparece "☁️ Compartido" en el mensaje

---

## Paso 4 (Opcional) — Backtesting automático

```bash
# Ejecutar grid search para encontrar parámetros óptimos
curl -X POST https://tu-dominio.vercel.app/api/retrain
```

Respuesta esperada:
```json
{
  "success": true,
  "optimalParams": {
    "baseLambda": 1.35,
    "rho": -0.08,
    "lambdaK": 1.8
  },
  "metrics": {
    "optimal": { "logLoss": 0.95, "brierScore": 0.19 }
  }
}
```

---

## Checklist Completo de Validación

### Funcionalidad existente (no debe romperse)
- [ ] Tab ⚡ Predictor — predicción de partido funciona
- [ ] Tab 🏆 Favoritos — lista de favoritos se carga
- [ ] Tab 📊 Grupos — simulación de grupos funciona
- [ ] Tab 🎲 Simulación Monte Carlo — worker funciona
- [ ] Tab 📝 Resultados — guardar resultado funciona
- [ ] Tab 📈 Desempeño — métricas se calculan
- [ ] Tab 🧮 Metodología — se muestra el contenido
- [ ] Export PNG — botón de exportar funciona
- [ ] Compartir enlace — URL params funcionan

### Funcionalidad nueva v6.0
- [ ] Tab 🤖 Análisis IA — se muestra en la nav
- [ ] Panel de Variables Contextuales — se expande/colapsa
- [ ] Al ejecutar predicción → análisis IA se activa automáticamente
- [ ] Orbe de Gemini animada durante carga
- [ ] Análisis en español aparece correctamente formateado
- [ ] Badge amarillo en tab "Análisis IA" cuando hay nuevo análisis
- [ ] Cache: el mismo partido no llama a Gemini dos veces
- [ ] Error state con botón de reintento funciona
- [ ] Al guardar resultado, aparece info de sincronización

### Backend APIs
- [ ] `GET /api/model-state` → 200 con estado
- [ ] `POST /api/analyze` con body válido → 200 con análisis
- [ ] `POST /api/analyze` sin API key → 503 con mensaje claro
- [ ] `GET /api/update-live-data` → 200 con teamUpdates
- [ ] `POST /api/results` → 200 con resultado guardado
- [ ] `POST /api/retrain` → 200 con parámetros óptimos

---

## Comandos de prueba local

```bash
# Probar el motor matemático (sin cambios)
npm run test:engine

# Probar sintaxis de los API files
node --check api/analyze.js
node --check api/update-live-data.js
node --check api/results.js
node --check api/model-state.js
node --check api/retrain.js
node --check api/lib/contextualFactors.js

# Servir localmente
npm run dev
# Abre: http://localhost:3000
```

---

## Arquitectura Final v6.0

```
┌──────────────────────────────────────────────────────┐
│                 FRONTEND (Vercel Static)               │
│  index.html   engine.js   results.js   app.js         │
│                     ↓ fetch()                         │
├──────────────────────────────────────────────────────┤
│           VERCEL SERVERLESS FUNCTIONS                  │
│  /api/analyze          → Gemini AI (análisis texto)    │
│  /api/update-live-data → ELO + forma (TheSportsDB)     │
│  /api/results          → CRUD compartido               │
│  /api/model-state      → Estado global del modelo      │
│  /api/retrain          → Grid search backtesting        │
├──────────────────────────────────────────────────────┤
│         STORAGE (Vercel KV — opcional)                 │
│  wc2026:shared:results      → Resultados todos users   │
│  wc2026:shared:calibration  → Estado ELO compartido    │
│  wc2026:shared:optimal_params → Params backtesting     │
└──────────────────────────────────────────────────────┘
```

---

## Notas de Seguridad

1. `GEMINI_API_KEY` **nunca** aparece en el código del browser
2. La key vive **solo** en Vercel Environment Variables
3. `api/analyze.js` valida que la key exista antes de procesar
4. Rate limiting implícito: Gemini permite 60 req/min en tier gratuito
5. Cache de 30 minutos en memoria del serverless evita llamadas duplicadas
6. El botón "Predictor" ahora llama a Gemini en background — no bloquea la UI

---

## Soporte

Si el análisis IA no aparece:
1. Verifica que `GEMINI_API_KEY` está en las env vars de Vercel
2. Revisa los logs en Vercel → Functions → `api/analyze`
3. El error más común: key inválida o con formato incorrecto
   - Las keys de Google AI Studio empiezan con `AIza...`
