const fs = require('fs');

const dataFile = 'data.json';
const WORLD_CUP_DATA = JSON.parse(fs.readFileSync(dataFile, 'utf8'));

const realSquadValues = {
    "Inglaterra": 99,
    "Francia": 98,
    "Portugal": 96,
    "Brasil": 95,
    "España": 94,
    "Argentina": 92,
    "Alemania": 91,
    "Países Bajos": 89,
    "Italia": 88,
    "Bélgica": 87,
    "Uruguay": 85,
    "Estados Unidos": 78
};

for (const [team, val] of Object.entries(realSquadValues)) {
    if (WORLD_CUP_DATA.teams[team]) {
        WORLD_CUP_DATA.teams[team].squadValue = val;
    }
}

fs.writeFileSync(dataFile, JSON.stringify(WORLD_CUP_DATA, null, 4), 'utf8');
console.log(`¡Actualizado!`);
