const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

// Initialize sql.js asynchronously
const dbPath = path.join(__dirname, 'rogold.db');
let dbPromise = initSqlJs().then(SQL => {
  let db;
  try {
    const filebuffer = fs.readFileSync(dbPath);
    db = new SQL.Database(filebuffer);
  } catch (err) {
    db = new SQL.Database(); // Create new database if file doesn't exist
  }
  return db;
});

// Function to save database to file
async function saveDatabase() {
  const db = await dbPromise;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);
}

// Create tables
dbPromise.then(db => {
  db.run(`
      CREATE TABLE IF NOT EXISTS games (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          data TEXT NOT NULL,
          thumbnail TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
  `);

  db.run(`
      CREATE TABLE IF NOT EXISTS maps (
          name TEXT PRIMARY KEY,
          data TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
  `);

  db.run(`
      CREATE TABLE IF NOT EXISTS players (
          id TEXT PRIMARY KEY,
          nickname TEXT UNIQUE NOT NULL,
          data TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
  `);

  // Save database after creating tables
  saveDatabase();
});

// Game functions
async function saveGame(gameId, gameData) {
    try {
        const db = await dbPromise;
        const { title, thumbnail, ...data } = gameData;
        const sql = `
            INSERT OR REPLACE INTO games (id, title, data, thumbnail, updated_at)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        `;
        const stmt = db.prepare(sql);
        stmt.run([gameId, title, JSON.stringify(data), thumbnail]);
        stmt.free();
        await saveDatabase();
        return { success: true };
    } catch (err) {
        throw err;
    }
}

async function getGame(gameId) {
    try {
        const db = await dbPromise;
        const sql = `SELECT * FROM games WHERE id = ?`;
        const stmt = db.prepare(sql);
        const result = stmt.getAsObject([gameId]);
        stmt.free();
        if (result && result.id) {
            const data = JSON.parse(result.data);
            return {
                id: result.id,
                title: result.title,
                thumbnail: result.thumbnail,
                ...data,
                createdAt: result.created_at,
                updatedAt: result.updated_at
            };
        } else {
            return null;
        }
    } catch (err) {
        throw err;
    }
}

async function getAllGames() {
    try {
        const db = await dbPromise;
        const sql = `SELECT id, title, thumbnail, created_at FROM games ORDER BY updated_at DESC`;
        const stmt = db.prepare(sql);
        const results = [];
        while (stmt.step()) {
            const row = stmt.getAsObject();
            results.push({
                id: row.id,
                title: row.title,
                thumbnail: row.thumbnail,
                timestamp: row.created_at
            });
        }
        stmt.free();
        return results;
    } catch (err) {
        throw err;
    }
}

async function deleteGame(gameId) {
    try {
        const db = await dbPromise;
        const sql = `DELETE FROM games WHERE id = ?`;
        const stmt = db.prepare(sql);
        stmt.run([gameId]);
        stmt.free();
        await saveDatabase();
        return { success: true };
    } catch (err) {
        throw err;
    }
}

// Synchronous versions for backward compatibility
async function saveGameSync(gameId, gameData) {
    try {
        const db = await dbPromise;
        const { title, thumbnail, ...data } = gameData;
        const sql = `
            INSERT OR REPLACE INTO games (id, title, data, thumbnail, updated_at)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        `;
        const stmt = db.prepare(sql);
        stmt.run([gameId, title || '', JSON.stringify(data), thumbnail || '']);
        stmt.free();
        await saveDatabase();
        return { success: true };
    } catch (error) {
        console.error('Error saving game:', error);
        return { success: false, error: error.message };
    }
}

async function getGameSync(gameId) {
    try {
        const db = await dbPromise;
        const sql = `SELECT * FROM games WHERE id = ?`;
        const stmt = db.prepare(sql);
        const result = stmt.getAsObject([gameId]);
        stmt.free();
        if (result && result.id) {
            const data = JSON.parse(result.data);
            return {
                id: result.id,
                title: result.title,
                thumbnail: result.thumbnail,
                ...data,
                createdAt: result.created_at,
                updatedAt: result.updated_at
            };
        }
        return null;
    } catch (error) {
        console.error('Error getting game:', error);
        return null;
    }
}

async function getAllGamesSync() {
    try {
        const db = await dbPromise;
        const sql = `SELECT id, title, thumbnail, created_at FROM games ORDER BY updated_at DESC`;
        const stmt = db.prepare(sql);
        const results = [];
        while (stmt.step()) {
            const row = stmt.getAsObject();
            results.push({
                id: row.id,
                title: row.title,
                thumbnail: row.thumbnail,
                timestamp: row.created_at
            });
        }
        stmt.free();
        return results;
    } catch (error) {
        console.error('Error getting all games:', error);
        return [];
    }
}

async function deleteGameSync(gameId) {
    try {
        const db = await dbPromise;
        const sql = `DELETE FROM games WHERE id = ?`;
        const stmt = db.prepare(sql);
        stmt.run([gameId]);
        stmt.free();
        await saveDatabase();
        return { success: true };
    } catch (error) {
        console.error('Error deleting game:', error);
        return { success: false, error: error.message };
    }
}

// Map functions
async function saveMap(mapName, mapData) {
    try {
        const db = await dbPromise;
        const sql = `
            INSERT OR REPLACE INTO maps (name, data, updated_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
        `;
        const stmt = db.prepare(sql);
        stmt.run([mapName, JSON.stringify(mapData)]);
        stmt.free();
        await saveDatabase();
        return { success: true };
    } catch (err) {
        throw err;
    }
}

async function getMap(mapName) {
    try {
        const db = await dbPromise;
        const sql = `SELECT * FROM maps WHERE name = ?`;
        const stmt = db.prepare(sql);
        const result = stmt.getAsObject([mapName]);
        stmt.free();
        if (result && result.name) {
            return JSON.parse(result.data);
        } else {
            return null;
        }
    } catch (err) {
        throw err;
    }
}

async function getAllMaps() {
    try {
        const db = await dbPromise;
        const sql = `SELECT name FROM maps ORDER BY updated_at DESC`;
        const stmt = db.prepare(sql);
        const results = [];
        while (stmt.step()) {
            const row = stmt.getAsObject();
            results.push(row.name);
        }
        stmt.free();
        return results;
    } catch (err) {
        throw err;
    }
}

async function deleteMap(mapName) {
    try {
        const db = await dbPromise;
        const sql = `DELETE FROM maps WHERE name = ?`;
        const stmt = db.prepare(sql);
        stmt.run([mapName]);
        stmt.free();
        await saveDatabase();
        return { success: true };
    } catch (err) {
        throw err;
    }
}

// Player functions
async function savePlayer(playerId, nickname, playerData = {}) {
    try {
        const db = await dbPromise;
        const sql = `
            INSERT OR REPLACE INTO players (id, nickname, data, updated_at)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        `;
        const stmt = db.prepare(sql);
        stmt.run([playerId, nickname, JSON.stringify(playerData)]);
        stmt.free();
        await saveDatabase();
        return { success: true };
    } catch (err) {
        throw err;
    }
}

async function getPlayer(playerId) {
    try {
        const db = await dbPromise;
        const sql = `SELECT * FROM players WHERE id = ?`;
        const stmt = db.prepare(sql);
        const result = stmt.getAsObject([playerId]);
        stmt.free();
        if (result && result.id) {
            return {
                id: result.id,
                nickname: result.nickname,
                data: JSON.parse(result.data || '{}'),
                createdAt: result.created_at,
                updatedAt: result.updated_at
            };
        } else {
            return null;
        }
    } catch (err) {
        throw err;
    }
}

async function getPlayerByNickname(nickname) {
    try {
        const db = await dbPromise;
        const sql = `SELECT * FROM players WHERE nickname = ?`;
        const stmt = db.prepare(sql);
        const result = stmt.getAsObject([nickname]);
        stmt.free();
        if (result && result.id) {
            return {
                id: result.id,
                nickname: result.nickname,
                data: JSON.parse(result.data || '{}'),
                createdAt: result.created_at,
                updatedAt: result.updated_at
            };
        } else {
            return null;
        }
    } catch (err) {
        throw err;
    }
}

async function getAllNicknames() {
    try {
        const db = await dbPromise;
        const sql = `SELECT nickname FROM players`;
        const stmt = db.prepare(sql);
        const results = [];
        while (stmt.step()) {
            const row = stmt.getAsObject();
            results.push(row.nickname);
        }
        stmt.free();
        return results;
    } catch (err) {
        throw err;
    }
}

async function deletePlayer(playerId) {
    try {
        const db = await dbPromise;
        const sql = `DELETE FROM players WHERE id = ?`;
        const stmt = db.prepare(sql);
        stmt.run([playerId]);
        stmt.free();
        await saveDatabase();
        return { success: true };
    } catch (err) {
        throw err;
    }
}


// Export functions
module.exports = {
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
    deletePlayer,
    dbPromise // Export dbPromise for direct access if needed
};