const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const helmet = require("helmet");
const fs = require('fs');
const {
    saveGame,
    getGame,
    getAllGames,
    deleteGame,
    saveGameSync,
    getGameSync,
    getAllGamesSync,
    deleteGameSync,
    saveMap,
    getMap,
    getAllMaps,
    deleteMap,
    savePlayer,
    getPlayer,
    getPlayerByNickname,
    getAllNicknames,
    deletePlayer
} = require('./database');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling'],
    // Enable per-message compression with a threshold to reduce bandwidth for large payloads
    perMessageDeflate: {
        threshold: 1024
    },
    // Faster liveness detection to drop stale sockets
    pingInterval: 15000,
    pingTimeout: 10000
});

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'players_data.json');
let playersData = {};

const MAPS_DIR = path.join(__dirname, 'maps');
// Ensure maps directory exists
if (!fs.existsSync(MAPS_DIR)) {
    fs.mkdirSync(MAPS_DIR);
}

const THUMBNAILS_DIR = path.join(__dirname, 'thumbnails');
// Ensure thumbnails directory exists
if (!fs.existsSync(THUMBNAILS_DIR)) {
    fs.mkdirSync(THUMBNAILS_DIR);
}

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

// Serve thumbnails directory
app.use('/thumbnails', express.static(THUMBNAILS_DIR));

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok', players: Object.keys(players).length });
});

// Map persistence API (SQLite database)
app.get('/api/maps', async (req, res) => {
    try {
        const maps = await getAllMaps();
        res.json({ maps });
    } catch (e) {
        res.status(500).json({ error: 'Failed to list maps' });
    }
});

app.get('/api/maps/:name', async (req, res) => {
    try {
        const safe = String(req.params.name || '').replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 64);
        if (!safe) return res.status(400).json({ error: 'Invalid name' });
        const mapData = await getMap(safe);
        if (!mapData) return res.status(404).json({ error: 'Not found' });
        res.type('application/json').send(JSON.stringify(mapData));
    } catch (e) {
        res.status(500).json({ error: 'Failed to load map' });
    }
});

app.post('/api/maps/:name', async (req, res) => {
    try {
        const safe = String(req.params.name || '').replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 64);
        if (!safe) return res.status(400).json({ error: 'Invalid name' });
        const data = req.body;
        if (!data || typeof data !== 'object') {
            return res.status(400).json({ error: 'Invalid JSON body' });
        }
        data.name = safe;
        data.updatedAt = new Date().toISOString();
        if (!data.createdAt) data.createdAt = data.updatedAt;

        const result = await saveMap(safe, data);
        if (result.success) {
            res.json({ ok: true, name: safe });
        } else {
            res.status(500).json({ error: 'Failed to save map' });
        }
    } catch (e) {
        res.status(500).json({ error: 'Failed to save map' });
    }
});

app.use(
  helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      // Allow secure and insecure websocket connections (wss/ws) in addition to self
      connectSrc: ["'self'", "ws:", "wss:"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  })
);


app.use(express.json({ limit: '50mb' }));
app.use(express.static("public"));

// Helper function to save data URL as file
function saveDataUrlAsFile(dataUrl, filename) {
    return new Promise((resolve, reject) => {
        try {
            // Ensure thumbnails directory exists
            if (!fs.existsSync(THUMBNAILS_DIR)) {
                fs.mkdirSync(THUMBNAILS_DIR, { recursive: true });
            }

            // Extract base64 data from data URL
            const matches = dataUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
            if (!matches || matches.length !== 3) {
                reject(new Error('Invalid data URL'));
                return;
            }

            const mimeType = matches[1];
            const base64Data = matches[2];
            const buffer = Buffer.from(base64Data, 'base64');

            const filePath = path.join(THUMBNAILS_DIR, filename);
            fs.writeFile(filePath, buffer, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(filePath);
                }
            });
        } catch (error) {
            reject(error);
        }
    });
}

// Games API endpoint for publishing (SQLite database)
app.post('/api/games', async (req, res) => {
    try {
        const gameData = req.body;
        if (!gameData || !gameData.title) {
            return res.status(400).json({ error: 'Game title is required' });
        }

        // Generate game ID if not provided
        const gameId = gameData.gameId || 'game_' + Date.now();

        // Handle thumbnail if it's a data URL
        if (gameData.thumbnail && gameData.thumbnail.startsWith('data:')) {
            try {
                const thumbnailFilename = `${gameId}_thumbnail.png`;
                await saveDataUrlAsFile(gameData.thumbnail, thumbnailFilename);
                // Update game data to use file path instead of data URL
                gameData.thumbnail = `/thumbnails/${thumbnailFilename}`;
            } catch (error) {
                console.warn('Failed to save thumbnail as file, using default:', error);
                gameData.thumbnail = 'thumbnail1.jpg';
            }
        } else {
            gameData.thumbnail = 'thumbnail1.jpg';
        }

        // Save game data to database
        const result = await saveGame(gameId, gameData);
        if (!result.success) {
            return res.status(500).json({ error: 'Failed to save game' });
        }

        console.log(`Game "${gameData.title}" published with ID: ${gameId}`);

        res.json({
            success: true,
            gameId: gameId,
            message: 'Game published successfully'
        });
    } catch (error) {
        console.error('Error publishing game:', error);
        res.status(500).json({ error: 'Failed to publish game' });
    }
});

// Get published games (SQLite database)
app.get('/api/games', async (req, res) => {
    try {
        const games = await getAllGames();
        res.json({ games });
    } catch (error) {
        console.error('Error listing games:', error);
        res.status(500).json({ error: 'Failed to list games' });
    }
});

// Get specific game (SQLite database)
app.get('/api/games/:gameId', async (req, res) => {
    try {
        const gameId = req.params.gameId;
        const gameData = await getGame(gameId);

        if (!gameData) {
            return res.status(404).json({ error: 'Game not found' });
        }

        res.json(gameData);
    } catch (error) {
        console.error('Error loading game:', error);
        res.status(500).json({ error: 'Failed to load game' });
    }
});

// Store connected players
let players = {};
const activeNicknames = {};
const GAME_TICK_RATE = 20; // 20 updates per second
// Networking/synchronization tunables
const MAX_MOVE_RATE = 30; // Max accepted move packets per second per client
const WORLD_BOUNDS = { xz: 250, yMin: 0, yMax: 500 }; // Clamp world to a reasonable area to avoid bad data

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, Number(v) || 0));
}
function normalizeAngle(a) {
  // keep angle between -PI..PI
  a = Number(a) || 0;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log(`Player connected: ${socket.id}`);

    // Room selection (per-game isolation)
    const roomName = (socket.handshake && socket.handshake.auth && socket.handshake.auth.room)
        ? String(socket.handshake.auth.room)
        : 'default';
    socket.join(roomName);
    socket.roomName = roomName;

    // REGISTRO DE NICKNAME ÚNICO
    socket.on('register', ({ nickname, faceId }) => {
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
            room: roomName,
            x: 0, y: 3, z: 0,
            rotation: 0,
            isMoving: false,
            health: 100,
            colors: {
                head: '#FAD417',
                torso: '#00A2FF',
                arms: '#FAD417',
                legs: '#80C91C'
            },
            hatId: null,
            faceId: faceId || 'OriginalGlitchedFace.webp'
        };

        // Envia apenas os players da mesma sala para o novo
        const roomPlayers = Object.fromEntries(
            Object.entries(players).filter(([_, p]) => p.room === roomName)
        );
        socket.emit('initialPlayers', roomPlayers);
        // Avise os outros da mesma sala
        socket.to(roomName).emit('playerJoined', players[socket.id]);
    });

    // CHAT
    socket.on('chat', msg => {
        io.to(roomName).emit('chat', { playerId: socket.id, nickname: socket.nickname, message: msg });
    });

    // MOVIMENTO
    socket.on('playerMove', (data) => {
        const now = Date.now();

        // Rate-limit incoming move packets to protect server and network
        if (socket.lastMoveAt && now - socket.lastMoveAt < (1000 / MAX_MOVE_RATE)) {
            return;
        }
        socket.lastMoveAt = now;

        const p = players[socket.id];
        if (!p) return;

        // Sanitize and clamp incoming data
        const x = clamp(data?.x, -WORLD_BOUNDS.xz, WORLD_BOUNDS.xz);
        const y = clamp(data?.y, WORLD_BOUNDS.yMin, WORLD_BOUNDS.yMax);
        const z = clamp(data?.z, -WORLD_BOUNDS.xz, WORLD_BOUNDS.xz);
        const rotation = normalizeAngle(data?.rotation ?? 0);
        const isMoving = !!data?.isMoving;
        const isInAir = !!data?.isInAir;

        p.x = x;
        p.y = y;
        p.z = z;
        p.rotation = rotation;
        p.isMoving = isMoving;
        p.isInAir = isInAir;
        p.nickname = socket.nickname; // always maintain nickname
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
        io.to(roomName).emit('playerHatChanged', { playerId: socket.id, hatId });
    });
    
    // FACE
    socket.on('faceChange', ({ faceId }) => {
        if (players[socket.id]) {
            players[socket.id].faceId = faceId;
        }
        io.to(roomName).emit('playerFaceChanged', { playerId: socket.id, faceId });
    });

    // FERRAMENTAS
    socket.on("equipTool", (data) => {
        socket.to(roomName).emit("remoteEquip", { playerId: socket.id, tool: data.tool });
    });
    socket.on("unequipTool", (data) => {
        socket.to(roomName).emit("remoteUnequip", { playerId: socket.id, tool: data.tool });
    });

    // DANÇA
    socket.on('dance', () => {
        socket.to(roomName).emit('dance', socket.id);
    });
    socket.on('stopDance', () => {
        socket.to(roomName).emit('stopDance', socket.id);
    });

    // ROCKET
    socket.on('launchRocket', data => {
        io.to(roomName).emit('spawnRocket', data);
    });

    // EXPLOSÃO
    socket.on('explosion', (data) => {
        io.to(roomName).emit('explosion', data);
    });

    // TAKE DAMAGE
    socket.on('takeDamage', ({ damage }) => {
        const p = players[socket.id];
        if (!p) return;
        p.health = Math.max(0, p.health - damage);
        if (p.health <= 0) {
            io.to(roomName).emit('playerDied', { killer: 'unknown', victim: socket.id });
        } else {
            io.to(roomName).emit('healthUpdate', { playerId: socket.id, health: p.health });
        }
    });

    // KILL EVENT -> notify room so killer and others see victim's death/respawn effect
    socket.on('playerHit', ({ killer, victim }) => {
        io.to(roomName).emit('playerDied', { killer, victim });
    });

    // RAGDOLL
    socket.on('playerRagdoll', (data) => {
        io.to(roomName).emit('playerRagdoll', data);
    });

    // ADMIN COMANDOS
    socket.on('danielCommand', () => {
        if (socket.nickname === 'daniel244') {
            if (socket.lastDaniel && Date.now() - socket.lastDaniel < 20000) return;
            socket.lastDaniel = Date.now();
            io.to(roomName).emit('danielEvent');
        }
    });
    socket.on('adminExplode', ({ target }) => {
        if (socket.nickname === 'notrealregi') {
            for (let id in players) {
                if (players[id].room === roomName && players[id].nickname === target) {
                    io.to(roomName).emit('adminExplode', { target });
                    break;
                }
            }
        }
    });

    // DESCONECTAR
    socket.on('disconnect', () => {
        delete activeNicknames[socket.id];
        const r = players[socket.id]?.room || roomName;
        delete players[socket.id];
        io.to(r).emit('playerLeft', socket.id);
    });
});

// GAME LOOP
setInterval(() => {
    // Emit per-room states to reduce cross-room traffic
    const byRoom = {};
    for (const [id, p] of Object.entries(players)) {
        const r = p.room || 'default';
        if (!byRoom[r]) byRoom[r] = {};
        byRoom[r][id] = p;
    }
    for (const [r, state] of Object.entries(byRoom)) {
        io.to(r).volatile.emit('gameState', state);
    }

    // Send initial faces data to new players
    for (const [r, state] of Object.entries(byRoom)) {
        const faces = {};
        for (const [id, p] of Object.entries(state)) {
            if (p.faceId) faces[id] = p.faceId;
        }
        if (Object.keys(faces).length > 0) {
            io.to(r).emit('initialFaces', faces);
        }
    }
}, 1000 / GAME_TICK_RATE);

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
});