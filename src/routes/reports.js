const express = require('express');
const { getDb } = require('../db');
const { requireAuth } = require('../middleware/requireAuth');

const router = express.Router();

router.post('/', requireAuth, function createReport(req, res) {
    const db = getDb();
    const reporterId = req.session.userId;
    const body = String(req.body.body || '').trim();
    let reportedUserId = req.body.reportedUserId;
    if (reportedUserId == null || reportedUserId === '') reportedUserId = null;
    else reportedUserId = parseInt(reportedUserId, 10);

    if (!body || body.length > 8000) {
        return res.status(400).json({ error: 'Descreva a denúncia (máx. 8000 caracteres).' });
    }
    if (reportedUserId && reportedUserId === reporterId) {
        return res.status(400).json({ error: 'Denúncia inválida.' });
    }
    if (reportedUserId) {
        const u = db.prepare('SELECT id FROM users WHERE id = ?').get(reportedUserId);
        if (!u) return res.status(404).json({ error: 'Usuário denunciado não encontrado.' });
    }

    const createdAt = new Date().toISOString();
    db.prepare('INSERT INTO reports (reporter_id, reported_user_id, body, created_at) VALUES (?, ?, ?, ?)').run(
        reporterId,
        reportedUserId,
        body,
        createdAt
    );

    return res.status(201).json({ ok: true });
});

module.exports = router;
