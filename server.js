const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling']
});

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'players_data.json');
let playersData = {};

// Load existing player data from file
if (fs.existsSync(DATA_FILE)) {
    playersData = JSON.parse(fs.readFileSync(DATA_FILE));
}

// Save player data to file
function savePlayersData() {
    fs.writeFileSync(DATA_FILE, JSON.stringify(playersData, null, 2));
}

// Serve static files
app.use(express.static(__dirname));

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok', players: Object.keys(players).length });
});

// Store connected players
let players = {};
const activeNicknames = {};
const GAME_TICK_RATE = 20; // 20 updates per second

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log(`Player connected: ${socket.id}`);

    // REGISTRO DE NICKNAME ÚNICO
    socket.on('register', ({ nickname }) => {
        // Bloqueia nick duplicado
        if (Object.values(activeNicknames).includes(nickname)) {
            socket.emit('nicknameError', 'A sua conta já está sendo usada neste mesmo momento por favor saia do jogo e troque a conta');
            socket.disconnect();
            return;
        }
        // Marca nickname como ativo
        activeNicknames[socket.id] = nickname;
        socket.nickname = nickname;

        // Cria player
        players[socket.id] = {
            id: socket.id,
            nickname: nickname,
            x: 0, y: 3, z: 0,
            rotation: 0,
            isMoving: false,
            colors: {
                head: '#FAD417',
                torso: '#00A2FF',
                arms: '#FAD417',
                legs: '#80C91C'
            },
            hatId: null
        };

        // Envia todos os players para o novo
        socket.emit('initialPlayers', players);
        // Avise os outros
        socket.broadcast.emit('playerJoined', players[socket.id]);
    });

    // CHAT
    socket.on('chat', msg => {
        io.emit('chat', { playerId: socket.id, nickname: socket.nickname, message: msg });
    });

    // MOVIMENTO
    socket.on('playerMove', (data) => {
        if (players[socket.id]) {
            Object.assign(players[socket.id], data);
            players[socket.id].nickname = socket.nickname; // sempre mantenha
        }
    });

    // CUSTOMIZAÇÃO
    socket.on('playerCustomize', (colors) => {
        if (players[socket.id]) {
            players[socket.id].colors = colors;
        }
    });

    // CHAPÉU
    socket.on('equipHat', ({ hatId }) => {
        if (players[socket.id]) {
            players[socket.id].hatId = hatId;
        }
        io.emit('playerHatChanged', { playerId: socket.id, hatId });
    });

    // FERRAMENTAS
    socket.on("equipTool", (data) => {
        socket.broadcast.emit("remoteEquip", { playerId: socket.id, tool: data.tool });
    });
    socket.on("unequipTool", (data) => {
        socket.broadcast.emit("remoteUnequip", { playerId: socket.id, tool: data.tool });
    });

    // DANÇA
    socket.on('dance', () => {
        socket.broadcast.emit('dance', socket.id);
    });
    socket.on('stopDance', () => {
        socket.broadcast.emit('stopDance', socket.id);
    });

    // ROCKET
    socket.on('launchRocket', data => {
        io.emit('spawnRocket', data);
    });

    // EXPLOSÃO
    socket.on('explosion', (data) => {
        io.emit('explosion', data);
    });

    // RAGDOLL
    socket.on('playerRagdoll', (data) => {
        io.emit('playerRagdoll', data);
    });

    // ADMIN COMANDOS
    socket.on('danielCommand', () => {
        if (socket.nickname === 'daniel244') {
            if (socket.lastDaniel && Date.now() - socket.lastDaniel < 20000) return;
            socket.lastDaniel = Date.now();
            io.emit('danielEvent');
        }
    });
    socket.on('adminExplode', ({ target }) => {
        if (socket.nickname === 'notrealregi') {
            for (let id in players) {
                if (players[id].nickname === target) {
                    io.emit('adminExplode', { target });
                    break;
                }
            }
        }
    });
    socket.on('adminFly', ({ target }) => {
        if (socket.nickname === 'notrealregi') {
            for (let id in players) {
                if (players[id].nickname === target) {
                    io.emit('adminFly', { target });
                    break;
                }
            }
        }
    });

    // DESCONECTAR
    socket.on('disconnect', () => {
        delete activeNicknames[socket.id];
        delete players[socket.id];
        io.emit('playerLeft', socket.id);
    });
});

// GAME LOOP
setInterval(() => {
    io.emit('gameState', players);
}, 1000 / GAME_TICK_RATE);

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
});