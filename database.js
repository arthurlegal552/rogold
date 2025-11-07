const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Create database connection
const dbPath = path.join(__dirname, 'rogold.db');
const db = new sqlite3.Database(dbPath);

// Create tables
db.serialize(() => {
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
});

// Game functions
function saveGame(gameId, gameData) {
    return new Promise((resolve, reject) => {
        const { title, thumbnail, ...data } = gameData;
        const sql = `
            INSERT OR REPLACE INTO games (id, title, data, thumbnail, updated_at)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        `;
        db.run(sql, [gameId, title, JSON.stringify(data), thumbnail], function(err) {
            if (err) {
                reject(err);
            } else {
                resolve({ success: true });
            }
        });
    });
}

function getGame(gameId) {
    return new Promise((resolve, reject) => {
        const sql = `SELECT * FROM games WHERE id = ?`;
        db.get(sql, [gameId], (err, row) => {
            if (err) {
                reject(err);
            } else if (row) {
                const data = JSON.parse(row.data);
                resolve({
                    id: row.id,
                    title: row.title,
                    thumbnail: row.thumbnail,
                    ...data,
                    createdAt: row.created_at,
                    updatedAt: row.updated_at
                });
            } else {
                resolve(null);
            }
        });
    });
}

function getAllGames() {
    return new Promise((resolve, reject) => {
        const sql = `SELECT id, title, thumbnail, created_at FROM games ORDER BY updated_at DESC`;
        db.all(sql, [], (err, rows) => {
            if (err) {
                reject(err);
            } else {
                resolve(rows.map(row => ({
                    id: row.id,
                    title: row.title,
                    thumbnail: row.thumbnail,
                    timestamp: row.created_at
                })));
            }
        });
    });
}

function deleteGame(gameId) {
    return new Promise((resolve, reject) => {
        const sql = `DELETE FROM games WHERE id = ?`;
        db.run(sql, [gameId], function(err) {
            if (err) {
                reject(err);
            } else {
                resolve({ success: true });
            }
        });
    });
}

// Synchronous versions for backward compatibility
function saveGameSync(gameId, gameData) {
    try {
        const { title, thumbnail, ...data } = gameData;
        const sql = `
            INSERT OR REPLACE INTO games (id, title, data, thumbnail, updated_at)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        `;
        db.run(sql, [gameId, title, JSON.stringify(data), thumbnail]);
        return { success: true };
    } catch (error) {
        console.error('Error saving game:', error);
        return { success: false, error: error.message };
    }
}

function getGameSync(gameId) {
    try {
        const sql = `SELECT * FROM games WHERE id = ?`;
        const row = db.get(sql, [gameId]);
        if (row) {
            const data = JSON.parse(row.data);
            return {
                id: row.id,
                title: row.title,
                thumbnail: row.thumbnail,
                ...data,
                createdAt: row.created_at,
                updatedAt: row.updated_at
            };
        }
        return null;
    } catch (error) {
        console.error('Error getting game:', error);
        return null;
    }
}

function getAllGamesSync() {
    try {
        const sql = `SELECT id, title, thumbnail, created_at FROM games ORDER BY updated_at DESC`;
        const rows = db.all(sql, []);
        return rows.map(row => ({
            id: row.id,
            title: row.title,
            thumbnail: row.thumbnail,
            timestamp: row.created_at
        }));
    } catch (error) {
        console.error('Error getting all games:', error);
        return [];
    }
}

function deleteGameSync(gameId) {
    try {
        const sql = `DELETE FROM games WHERE id = ?`;
        db.run(sql, [gameId]);
        return { success: true };
    } catch (error) {
        console.error('Error deleting game:', error);
        return { success: false, error: error.message };
    }
}

// Map functions
function saveMap(mapName, mapData) {
    return new Promise((resolve, reject) => {
        const sql = `
            INSERT OR REPLACE INTO maps (name, data, updated_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
        `;
        db.run(sql, [mapName, JSON.stringify(mapData)], function(err) {
            if (err) {
                reject(err);
            } else {
                resolve({ success: true });
            }
        });
    });
}

function getMap(mapName) {
    return new Promise((resolve, reject) => {
        const sql = `SELECT * FROM maps WHERE name = ?`;
        db.get(sql, [mapName], (err, row) => {
            if (err) {
                reject(err);
            } else if (row) {
                resolve(JSON.parse(row.data));
            } else {
                resolve(null);
            }
        });
    });
}

function getAllMaps() {
    return new Promise((resolve, reject) => {
        const sql = `SELECT name FROM maps ORDER BY updated_at DESC`;
        db.all(sql, [], (err, rows) => {
            if (err) {
                reject(err);
            } else {
                resolve(rows.map(row => row.name));
            }
        });
    });
}

function deleteMap(mapName) {
    return new Promise((resolve, reject) => {
        const sql = `DELETE FROM maps WHERE name = ?`;
        db.run(sql, [mapName], function(err) {
            if (err) {
                reject(err);
            } else {
                resolve({ success: true });
            }
        });
    });
}

// Player functions
function savePlayer(playerId, nickname, playerData = {}) {
    return new Promise((resolve, reject) => {
        const sql = `
            INSERT OR REPLACE INTO players (id, nickname, data, updated_at)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        `;
        db.run(sql, [playerId, nickname, JSON.stringify(playerData)], function(err) {
            if (err) {
                reject(err);
            } else {
                resolve({ success: true });
            }
        });
    });
}

function getPlayer(playerId) {
    return new Promise((resolve, reject) => {
        const sql = `SELECT * FROM players WHERE id = ?`;
        db.get(sql, [playerId], (err, row) => {
            if (err) {
                reject(err);
            } else if (row) {
                resolve({
                    id: row.id,
                    nickname: row.nickname,
                    data: JSON.parse(row.data || '{}'),
                    createdAt: row.created_at,
                    updatedAt: row.updated_at
                });
            } else {
                resolve(null);
            }
        });
    });
}

function getPlayerByNickname(nickname) {
    return new Promise((resolve, reject) => {
        const sql = `SELECT * FROM players WHERE nickname = ?`;
        db.get(sql, [nickname], (err, row) => {
            if (err) {
                reject(err);
            } else if (row) {
                resolve({
                    id: row.id,
                    nickname: row.nickname,
                    data: JSON.parse(row.data || '{}'),
                    createdAt: row.created_at,
                    updatedAt: row.updated_at
                });
            } else {
                resolve(null);
            }
        });
    });
}

function getAllNicknames() {
    return new Promise((resolve, reject) => {
        const sql = `SELECT nickname FROM players`;
        db.all(sql, [], (err, rows) => {
            if (err) {
                reject(err);
            } else {
                resolve(rows.map(row => row.nickname));
            }
        });
    });
}

function deletePlayer(playerId) {
    return new Promise((resolve, reject) => {
        const sql = `DELETE FROM players WHERE id = ?`;
        db.run(sql, [playerId], function(err) {
            if (err) {
                reject(err);
            } else {
                resolve({ success: true });
            }
        });
    });
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
    db // Export db for direct access if needed
};