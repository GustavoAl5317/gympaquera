const { getDb } = require('./db');

function isBlocked(a, b) {
    const db = getDb();
    const r = db
        .prepare(
            'SELECT 1 AS x FROM user_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)'
        )
        .get(a, b, b, a);
    return !!r;
}

/**
 * @returns {{ message: object } | { error: string }}
 */
function insertMessage(fromUserId, toUserId, bodyRaw) {
    const db = getDb();
    const me = Number(fromUserId);
    const other = parseInt(toUserId, 10);
    const body = String(bodyRaw || '').trim();

    if (!me || Number.isNaN(me) || !other || Number.isNaN(other) || other === me) {
        return { error: 'Destinatário inválido.' };
    }
    if (!body || body.length > 8000) {
        return { error: 'Mensagem vazia ou muito longa.' };
    }
    if (isBlocked(me, other)) {
        return { error: 'Não é possível enviar mensagem para este usuário.' };
    }

    const exists = db.prepare('SELECT id FROM users WHERE id = ?').get(other);
    if (!exists) {
        return { error: 'Usuário não encontrado.' };
    }

    const createdAt = new Date().toISOString();
    const info = db
        .prepare('INSERT INTO messages (from_user_id, to_user_id, body, created_at) VALUES (?, ?, ?, ?)')
        .run(me, other, body, createdAt);
    const row = db
        .prepare('SELECT id, from_user_id, to_user_id, body, created_at FROM messages WHERE id = ?')
        .get(info.lastInsertRowid);

    return {
        message: {
            id: row.id,
            from_user_id: row.from_user_id,
            to_user_id: row.to_user_id,
            body: row.body,
            created_at: row.created_at
        }
    };
}

module.exports = { insertMessage, isBlocked };
