const fs = require('fs');

const dataFile = 'data.json';
const WORLD_CUP_DATA = JSON.parse(fs.readFileSync(dataFile, 'utf8'));

const elitePlayers = {
    // Inglaterra
    "Jude Bellingham": { penaltyRating: 92, goals: 25, assists: 14 },
    "Phil Foden": { penaltyRating: 89, goals: 20, assists: 10 },
    "Bukayo Saka": { penaltyRating: 89, goals: 18, assists: 12 },
    "Harry Kane": { penaltyRating: 91, goals: 38, assists: 10 },
    "Declan Rice": { penaltyRating: 88, goals: 6, assists: 8 },
    "Cole Palmer": { penaltyRating: 88, goals: 24, assists: 14 },
    "John Stones": { penaltyRating: 86 },
    "Trent Alexander-Arnold": { penaltyRating: 87, assists: 15 },
    "Kyle Walker": { penaltyRating: 85 },
    "Jordan Pickford": { penaltyRating: 85 },

    // Francia
    "Kylian Mbappé": { penaltyRating: 92, goals: 40, assists: 12 },
    "Antoine Griezmann": { penaltyRating: 88, goals: 18, assists: 15 },
    "William Saliba": { penaltyRating: 88 },
    "Aurélien Tchouaméni": { penaltyRating: 87 },
    "Eduardo Camavinga": { penaltyRating: 86 },
    "Ousmane Dembélé": { penaltyRating: 86, goals: 10, assists: 16 },
    "Theo Hernández": { penaltyRating: 86 },
    "Mike Maignan": { penaltyRating: 88 },
    "Dayot Upamecano": { penaltyRating: 85 },

    // Brasil
    "Vinícius Júnior": { penaltyRating: 92, goals: 26, assists: 12 },
    "Rodrygo": { penaltyRating: 88, goals: 18, assists: 10 },
    "Alisson": { penaltyRating: 89 },
    "Ederson": { penaltyRating: 89 },
    "Marquinhos": { penaltyRating: 87 },
    "Bruno Guimarães": { penaltyRating: 87 },
    "Lucas Paquetá": { penaltyRating: 86 },
    "Gabriel Martinelli": { penaltyRating: 85 },
    "Endrick": { penaltyRating: 84, goals: 12 },
    "Eder Militão": { penaltyRating: 87 },

    // España
    "Lamine Yamal": { penaltyRating: 87, goals: 12, assists: 14 },
    "Rodri": { penaltyRating: 91, goals: 10, assists: 12 },
    "Pedri": { penaltyRating: 87, assists: 10 },
    "Gavi": { penaltyRating: 85 },
    "Dani Olmo": { penaltyRating: 86, goals: 14, assists: 8 },
    "Nico Williams": { penaltyRating: 86, goals: 10, assists: 12 },
    "Dani Carvajal": { penaltyRating: 86 },
    "Unai Simón": { penaltyRating: 85 },
    "Aymeric Laporte": { penaltyRating: 85 },

    // Alemania
    "Florian Wirtz": { penaltyRating: 89, goals: 18, assists: 20 },
    "Jamal Musiala": { penaltyRating: 89, goals: 16, assists: 12 },
    "Ilkay Gündoğan": { penaltyRating: 87 },
    "Antonio Rüdiger": { penaltyRating: 88 },
    "Joshua Kimmich": { penaltyRating: 87 },
    "Leroy Sané": { penaltyRating: 86 },
    "Kai Havertz": { penaltyRating: 86, goals: 15 },
    "Marc-André ter Stegen": { penaltyRating: 88 },
    "Manuel Neuer": { penaltyRating: 87 },

    // Argentina
    "Lionel Messi": { penaltyRating: 90, goals: 25, assists: 18 },
    "Lautaro Martínez": { penaltyRating: 89, goals: 28, assists: 6 },
    "Julián Álvarez": { penaltyRating: 87, goals: 18, assists: 10 },
    "Emiliano Martínez": { penaltyRating: 88 },
    "Alexis Mac Allister": { penaltyRating: 87, goals: 8, assists: 8 },
    "Enzo Fernández": { penaltyRating: 85 },
    "Cristian Romero": { penaltyRating: 87 },
    "Lisandro Martínez": { penaltyRating: 86 },
    "Rodrigo De Paul": { penaltyRating: 85 },

    // Portugal
    "Cristiano Ronaldo": { penaltyRating: 88, goals: 35 },
    "Bruno Fernandes": { penaltyRating: 89, goals: 16, assists: 20 },
    "Bernardo Silva": { penaltyRating: 88, goals: 12, assists: 14 },
    "Rafael Leão": { penaltyRating: 87, goals: 15, assists: 12 },
    "Rúben Dias": { penaltyRating: 88 },
    "João Cancelo": { penaltyRating: 86 },

    // Países Bajos
    "Virgil van Dijk": { penaltyRating: 89 },
    "Frenkie de Jong": { penaltyRating: 87 },
    "Xavi Simons": { penaltyRating: 86, goals: 12, assists: 14 },
    "Matthijs de Ligt": { penaltyRating: 85 },
    "Cody Gakpo": { penaltyRating: 86, goals: 16 },

    // Bélgica
    "Kevin De Bruyne": { penaltyRating: 90, assists: 22 },
    "Thibaut Courtois": { penaltyRating: 90 },
    "Jérémy Doku": { penaltyRating: 85 },
    "Romelu Lukaku": { penaltyRating: 86, goals: 20 },

    // Uruguay
    "Federico Valverde": { penaltyRating: 89, goals: 10, assists: 8 },
    "Ronald Araújo": { penaltyRating: 87 },
    "Darwin Núñez": { penaltyRating: 86, goals: 22 }
};

// Normalizar nombres para comparación sin acentos
function normalize(str) {
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

const eliteKeys = Object.keys(elitePlayers);
let updatedCount = 0;

Object.values(WORLD_CUP_DATA.teams).forEach(team => {
    if (team.players) {
        team.players.forEach(p => {
            const normPlayer = normalize(p.name);
            const eliteName = eliteKeys.find(k => normalize(k) === normPlayer);
            if (eliteName) {
                const stats = elitePlayers[eliteName];
                if (stats.penaltyRating !== undefined) p.penaltyRating = stats.penaltyRating;
                if (stats.goals !== undefined) p.goals = stats.goals;
                if (stats.assists !== undefined) p.assists = stats.assists;
                updatedCount++;
            }
        });
    }
});

fs.writeFileSync(dataFile, JSON.stringify(WORLD_CUP_DATA, null, 4), 'utf8');
console.log(`¡Éxito! Se actualizaron las estadísticas de ${updatedCount} jugadores de élite a su Prime 25/26.`);
