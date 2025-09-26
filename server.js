const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const helmet = require("helmet");
const fs = require('fs');

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

// Map persistence API (JSON), stores maps under ./maps as {name}.json
app.get('/api/maps', (req, res) => {
    try {
        const files = fs.existsSync(MAPS_DIR) ? fs.readdirSync(MAPS_DIR) : [];
        const maps = files.filter(f => f.endsWith('.json')).map(f => path.basename(f, '.json'));
        res.json({ maps });
    } catch (e) {
        res.status(500).json({ error: 'Failed to list maps' });
    }
});

app.get('/api/maps/:name', (req, res) => {
    try {
        const safe = String(req.params.name || '').replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 64);
        if (!safe) return res.status(400).json({ error: 'Invalid name' });
        const filePath = path.join(MAPS_DIR, safe + '.json');
        if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
        const json = fs.readFileSync(filePath, 'utf8');
        res.type('application/json').send(json);
    } catch (e) {
        res.status(500).json({ error: 'Failed to load map' });
    }
});

app.post('/api/maps/:name', (req, res) => {
    try {
        const safe = String(req.params.name || '').replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 64);
        if (!safe) return res.status(400).json({ error: 'Invalid name' });
        const filePath = path.join(MAPS_DIR, safe + '.json');
        const data = req.body;
        if (!data || typeof data !== 'object') {
            return res.status(400).json({ error: 'Invalid JSON body' });
        }
        data.name = safe;
        data.updatedAt = new Date().toISOString();
        if (!data.createdAt) data.createdAt = data.updatedAt;
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
        res.json({ ok: true, name: safe });
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
            room: roomName,
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
}, 1000 / GAME_TICK_RATE);

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
});