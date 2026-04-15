const express = require('express');
const { getDb } = require('../db');
const { requireAuth } = require('../middleware/requireAuth');
const { isBlocked } = require('../messageStore');
const { sendChatMessage } = require('../chatDispatch');
const { isUserOnline } = require('../presence');

const router = express.Router();

router.get('/conversations', requireAuth, function conversations(req, res) {
    const db = getDb();
    const uid = req.session.userId;

    const rows = db
        .prepare(
            `
        SELECT t.oid AS other_id, m.body AS last_body, m.created_at AS last_at, u.nickname, u.public_uid AS other_public_uid,
               u.last_seen AS other_last_seen
        FROM (
            SELECT
                CASE WHEN from_user_id = ? THEN to_user_id ELSE from_user_id END AS oid,
                MAX(id) AS mid
            FROM messages
            WHERE from_user_id = ? OR to_user_id = ?
            GROUP BY CASE WHEN from_user_id = ? THEN to_user_id ELSE from_user_id END
        ) t
        JOIN messages m ON m.id = t.mid
        JOIN users u ON u.id = t.oid
        WHERE t.oid NOT IN (SELECT blocked_id FROM user_blocks WHERE blocker_id = ?)
          AND t.oid NOT IN (SELECT blocker_id FROM user_blocks WHERE blocked_id = ?)
        ORDER BY m.created_at DESC
    `
        )
        .all(uid, uid, uid, uid, uid, uid);

    const out = rows.map(function (r) {
        return {
            other_id: r.other_id,
            last_body: r.last_body,
            last_at: r.last_at,
            nickname: r.nickname,
            other_public_uid: r.other_public_uid,
            other_last_seen: r.other_last_seen || null,
            other_online: isUserOnline(r.other_id)
        };
    });

    return res.json({ conversations: out });
});

router.get('/with/:userId', requireAuth, function getThread(req, res) {
    const db = getDb();
    const me = req.session.userId;
    const other = parseInt(req.params.userId, 10);
    if (!other || other === me) return res.status(400).json({ error: 'Conversa inválida.' });
    if (isBlocked(me, other)) return res.status(403).json({ error: 'Você não pode ver esta conversa.' });

    const rows = db
        .prepare(
            `
        SELECT id, from_user_id, to_user_id, body, created_at
        FROM messages
        WHERE (from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?)
        ORDER BY created_at ASC
        LIMIT 500
    `
        )
        .all(me, other, other, me);

    return res.json({ messages: rows });
});

router.post('/with/:userId', requireAuth, function postMessage(req, res) {
    const me = req.session.userId;
    const other = parseInt(req.params.userId, 10);
    try {
        const result = sendChatMessage(me, other, req.body.body);
        if (result.error) {
            var status = 400;
            if (result.error === 'Usuário não encontrado.') status = 404;
            else if (result.error.indexOf('Não é possível enviar') !== -1) status = 403;
            else if (result.code === 'PAYMENT_REQUIRED') status = 403;
            var payload = { error: result.error };
            if (result.code) payload.code = result.code;
            return res.status(status).json(payload);
        }
        return res.status(201).json({ message: result.message });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: e.message || 'Erro ao enviar.' });
    }
});

module.exports = router;
