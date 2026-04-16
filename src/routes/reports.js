const express = require('express');
const { getDb } = require('../db');
const { requireAuth } = require('../middleware/requireAuth');
const { notifyReportToAdmin } = require('../notifyEmail');

const router = express.Router();

router.post('/', requireAuth, function createReport(req, res) {
    const db = getDb();
    const reporterId = req.session.userId;
    const body = String(req.body.body || '').trim();
    const pubRaw =
        req.body.reportedPublicUid != null ? String(req.body.reportedPublicUid).trim() : '';

    if (!body || body.length > 8000) {
        return res.status(400).json({ error: 'Descreva a denúncia (máx. 8000 caracteres).' });
    }
    if (!pubRaw) {
        return res.status(400).json({ error: 'Informe o código público do perfil denunciado.' });
    }

    const row = db
        .prepare("SELECT id FROM users WHERE LOWER(TRIM(COALESCE(public_uid, ''))) = LOWER(?)")
        .get(pubRaw);
    if (!row) {
        return res.status(404).json({ error: 'Código público não encontrado.' });
    }
    const reportedUserId = row.id;

    if (reportedUserId === reporterId) {
        return res.status(400).json({ error: 'Denúncia inválida.' });
    }

    const createdAt = new Date().toISOString();
    db.prepare('INSERT INTO reports (reporter_id, reported_user_id, body, created_at) VALUES (?, ?, ?, ?)').run(
        reporterId,
        reportedUserId,
        body,
        createdAt
    );

    const reporter = db.prepare('SELECT nickname, email FROM users WHERE id = ?').get(reporterId);
    const reported = db
        .prepare('SELECT nickname, email, public_uid FROM users WHERE id = ?')
        .get(reportedUserId);
    notifyReportToAdmin({
        reporter: reporter || {},
        reported: reported || {},
        body: body,
        createdAt: createdAt
    }).catch(function (err) {
        console.warn('[reports/mail]', err && err.message ? err.message : err);
    });

    return res.status(201).json({ ok: true });
});

module.exports = router;
