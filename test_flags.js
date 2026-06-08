const fs = require('fs');
const WORLD_CUP_DATA = JSON.parse(fs.readFileSync('data.json', 'utf8'));

const flags = new Set();
Object.values(WORLD_CUP_DATA.teams).forEach(t => {
    if (t.flag) flags.add(t.flag);
});

for (let emoji of flags) {
    let code = '';
    if (emoji === '🏴󠁧󠁢󠁥󠁮󠁧󠁿') code = 'gb-eng';
    else if (emoji === '🏴󠁧󠁢󠁳󠁣󠁴󠁿') code = 'gb-sct';
    else if (emoji === '🏴󠁧󠁢󠁷󠁬󠁳󠁿') code = 'gb-wls';
    else {
        const c1 = emoji.codePointAt(0);
        const c2 = emoji.codePointAt(2);
        if (c1 >= 0x1F1E6 && c1 <= 0x1F1FF && c2 >= 0x1F1E6 && c2 <= 0x1F1FF) {
            code = String.fromCharCode(c1 - 0x1F1E6 + 97) + String.fromCharCode(c2 - 0x1F1E6 + 97);
        }
    }
    console.log(`Emoji: ${emoji}, Code: ${code}, C1: ${emoji.codePointAt(0).toString(16)}, C2: ${emoji.codePointAt(2)?.toString(16)}`);
}
