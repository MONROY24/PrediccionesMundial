const mdToHtml = (text) => {
    if (!text) return '';
    return text
        .replace(/^## (.+)$/gm, '<h3 class="ai-section-h">$1</h3>')
        .replace(/^### (.+)$/gm, '<h4 class="ai-section-h4">$1</h4>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/^- (.+)$/gm, '<li>$1</li>')
        .replace(/(<li>.*<\/li>\n?)+/g, '<ul class="ai-list">$&</ul>')
        .replace(/\n\n/g, '</p><p class="ai-para">')
        .replace(/^(?!<[hul])(.+)$/gm, '<p class="ai-para">$1</p>')
        .replace(/<p class="ai-para"><\/p>/g, '');
};
const input = `¡Atención, aficionados al fútbol mundial! Soy su analista jefe del Predictor Mundial 2026, y el rugido de nuestro motor matemático, el Poisson-Dixon-Coles v5.0, resuena con la tensión de un choque de titanes: ¡Argentina contra Francia! 💥 Preparen sus bufandas

## 📋 Contexto del Partido
La rivalidad histórica y qué está en juego en el Mundial 2026

## ⚖️ Análisis de Fuerzas
**Argentina:** 2 fortalezas clave | 1 debilidad principal`;
console.log(mdToHtml(input));
