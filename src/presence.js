/** Contagem de sockets por usuário (presença online). */

const { getDb } = require('./db');

const socketCounts = new Map();

function getPeerUserIds(userId) {
    const db = getDb();
    const rows = db
        .prepare(
            `SELECT DISTINCT CASE WHEN from_user_id = ? THEN to_user_id ELSE from_user_id END AS pid
            FROM messages
            WHERE from_user_id = ? OR to_user_id = ?`
        )
        .all(userId, userId, userId);
    return rows.map(function (r) {
        return r.pid;
    });
}

function notifyPeersPresence(io, userId, online, peers) {
    if (!io || !peers || !peers.length) return;
    peers.forEach(function (pid) {
        io.to('user:' + pid).emit('presence:peer', { userId: userId, online: !!online });
    });
}

function onSocketConnect(io, userId) {
    const uid = Number(userId);
    if (!uid || Number.isNaN(uid)) return;
    const prev = socketCounts.get(uid) || 0;
    socketCounts.set(uid, prev + 1);
    if (prev === 0) {
        try {
            notifyPeersPresence(io, uid, true, getPeerUserIds(uid));
        } catch (_) {}
    }
}

function onSocketDisconnect(io, userId) {
    const uid = Number(userId);
    if (!uid || Number.isNaN(uid)) return;
    const prev = socketCounts.get(uid) || 0;
    if (prev <= 1) {
        socketCounts.delete(uid);
        const iso = new Date().toISOString();
        try {
            getDb().prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(iso, uid);
        } catch (_) {}
        try {
            notifyPeersPresence(io, uid, false, getPeerUserIds(uid));
        } catch (_) {}
    } else {
        socketCounts.set(uid, prev - 1);
    }
}

function isUserOnline(userId) {
    const uid = Number(userId);
    return (socketCounts.get(uid) || 0) > 0;
}

module.exports = {
    onSocketConnect,
    onSocketDisconnect,
    isUserOnline,
    getPeerUserIds
};
