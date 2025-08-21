const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

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

// Serve static files
app.use(express.static(__dirname));

io.on('connection', socket => {
    socket.on('chat', msg => {
        io.emit('chat', { playerId: socket.id, message: msg });
    });
});

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
const GAME_TICK_RATE = 20; // 20 updates per second

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log(`Player connected: ${socket.id}`);
    
    // Send current players to new player
    socket.emit('initialPlayers', players);
    
    // Add new player
    players[socket.id] = {
        id: socket.id,
        x: 0,
        y: 3,
        z: 0,
        rotation: 0,
        isMoving: false,
        // Default colors
        colors: {
            head: '#FAD417',
            torso: '#00A2FF',
            arms: '#FAD417',
            legs: '#80C91C'
        }
    };

    io.on("connection", (socket) => {
    socket.on("equipTool", (data) => {
        socket.broadcast.emit("remoteEquip", { playerId: socket.id, tool: data.tool });
    });

    socket.on("unequipTool", (data) => {
        socket.broadcast.emit("remoteUnequip", { playerId: socket.id, tool: data.tool });
    });
});
    
    // Notify other players about new player
    socket.broadcast.emit('playerJoined', players[socket.id]);

    socket.on('playerAnim', (data) => {
  const id = data.playerId;
  if (!remotePlayers[id]) return;
  const rp = remotePlayers[id];
  const name = data.anim;

  // evita re-aplicar o mesmo estado várias vezes
  if (rp.currentAnim === name) return;
  rp.currentAnim = name;

  const action = rp.actions[name];
  if (!action) return;

  // configura loop e tempo
  action.reset();
  action.setLoop(data.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
  const clipDur = action.getClip().duration || 1;
  action.time = (data.normalizedTime || 0) * clipDur;

  // crossfade (suave)
  if (rp.lastAction && rp.lastAction !== action) {
    rp.lastAction.crossFadeTo(action, 0.18, false);
  } else {
    action.play();
  }
  rp.lastAction = action;
});
    
    // Handle player movement
    socket.on('playerMove', (data) => {
        if (players[socket.id]) {
            players[socket.id].x = data.x;
            players[socket.id].y = data.y;
            players[socket.id].z = data.z;
            players[socket.id].rotation = data.rotation;
            players[socket.id].isMoving = data.isMoving;
            
            // Movement is now broadcasted by the game loop, not here.
        }
    });
    
    // Handle player color customization
    socket.on('playerCustomize', (colors) => {
        if (players[socket.id]) {
            players[socket.id].colors = colors;
            // The color change will be broadcast in the next game state update.
        }
    });

    // valida/repete animação para outros
socket.on('playerAnim', (data) => {
  // validações simples - string e taxa de envio
  if (!data || typeof data.anim !== 'string') return;

  // opcional: throttle por socket para evitar spam (ex.: 5 msgs/s)
  const now = Date.now();
  socket.lastAnimAt = socket.lastAnimAt || 0;
  if (now - socket.lastAnimAt < 150) return; // 150ms min entre animações
  socket.lastAnimAt = now;

  // re-broadcast para todos (exceto quem enviou) com id do jogador
  socket.broadcast.emit('playerAnim', {
    playerId: socket.id,
    anim: data.anim,
    loop: !!data.loop,
    normalizedTime: typeof data.normalizedTime === 'number' ? data.normalizedTime : 0,
    timestamp: now
  });
});
    
    // Handle disconnection
    socket.on('disconnect', () => {
        console.log(`Player disconnected: ${socket.id}`);
        delete players[socket.id];
        socket.broadcast.emit('playerLeft', socket.id);
    });

    socket.on('damage', (data) => {
        if (players[data.targetId]) {
            players[data.targetId].health = Math.max(0, players[data.targetId].health - data.amount);
            players[data.targetId].dead = players[data.targetId].health <= 0;
            io.emit('gameState', players);
        }
    });
    
    // Handle connection errors
    socket.on('connect_error', (error) => {
        console.log('Connection error:', error);
    });
    
    // Handle dance emote
    socket.on('dance', () => {
        // Broadcast to all clients except the sender
        socket.broadcast.emit('dance', socket.id);
    });

    // Handle stop dance emote
    socket.on('stopDance', () => {
        socket.broadcast.emit('stopDance', socket.id);
    });
});

// Server-side game loop
setInterval(() => {
    io.emit('gameState', players);
}, 1000 / GAME_TICK_RATE);

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
});