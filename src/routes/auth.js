const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { getDb, root } = require('../db');
const { requireAuth } = require('../middleware/requireAuth');
const { assertAdult } = require('../userValidation');

const router = express.Router();
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: function fileFilter(_req, file, cb) {
        if (!file.mimetype.startsWith('image/')) {
            cb(new Error('Envie apenas imagens.'));
            return;
        }
        cb(null, true);
    }
});

function safeUser(row) {
    if (!row) return null;
    var until = row.premium_until || null;
    var active = false;
    if (until) {
        var d = new Date(until);
        if (!Number.isNaN(d.getTime()) && d > new Date()) active = true;
    }
    return {
        id: row.id,
        publicUid: row.public_uid || null,
        email: row.email,
        sou: row.sou,
        procuro: row.procuro,
        gym: row.gym,
        matricula: row.matricula,
        estado: row.estado,
        cidade: row.cidade,
        nickname: row.nickname,
        nascimento: row.nascimento,
        createdAt: row.created_at,
        premiumUntil: until,
        premiumActive: active
    };
}

router.post('/register', upload.array('photos', 3), function register(req, res) {
    const db = getDb();
    try {
        const email = String(req.body.email || '').trim().toLowerCase();
        const password = String(req.body.password || '');
        const sou = String(req.body.sou || '').trim();
        const procuro = String(req.body.procuro || '').trim();
        const gym = String(req.body.gym || '').trim();
        const matricula = String(req.body.matricula || '').trim();
        const estado = String(req.body.estado || '').trim();
        const cidade = String(req.body.cidade || '').trim();
        const nickname = String(req.body.nickname || '').trim();
        const nascimento = String(req.body.nascimento || '').trim();

        if (!email || !password || password.length < 6) {
            return res.status(400).json({ error: 'E-mail e senha (mín. 6 caracteres) são obrigatórios.' });
        }
        if (!sou || !procuro || !gym || !estado || !cidade || !nickname || !nascimento) {
            return res.status(400).json({ error: 'Preencha todos os campos obrigatórios.' });
        }

        assertAdult(nascimento);

        const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
        if (exists) {
            return res.status(409).json({ error: 'Este e-mail já está cadastrado.' });
        }

        const passwordHash = bcrypt.hashSync(password, 10);
        const createdAt = new Date().toISOString();

        const insertUser = db.prepare(`
            INSERT INTO users (email, password_hash, public_uid, sou, procuro, gym, matricula, estado, cidade, nickname, nascimento, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const insertPhoto = db.prepare('INSERT INTO photos (user_id, path, sort_order) VALUES (?, ?, ?)');

        const files = req.files || [];
        const extMap = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

        const run = db.transaction(function () {
            const info = insertUser.run(
                email,
                passwordHash,
                crypto.randomUUID(),
                sou,
                procuro,
                gym,
                matricula || null,
                estado,
                cidade,
                nickname,
                nascimento,
                createdAt
            );
            const userId = info.lastInsertRowid;
            for (var i = 0; i < files.length; i++) {
                const file = files[i];
                const ext = extMap[file.mimetype] || '.img';
                const rel = path.join('uploads', userId + '_' + i + ext).replace(/\\/g, '/');
                const abs = path.join(root, rel);
                fs.writeFileSync(abs, file.buffer);
                insertPhoto.run(userId, rel, i);
            }
        });

        run();

        return res.status(201).json({ ok: true });
    } catch (e) {
        if (e && e.message === 'Envie apenas imagens.') {
            return res.status(400).json({ error: e.message });
        }
        if (e && e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return res.status(409).json({ error: 'Este e-mail já está cadastrado.' });
        }
        const msg = e && e.message ? e.message : 'Erro ao cadastrar.';
        return res.status(400).json({ error: msg });
    }
});

router.post('/login', function login(req, res) {
    const db = getDb();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (!email || !password) {
        return res.status(400).json({ error: 'Informe e-mail e senha.' });
    }
    const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!row || !bcrypt.compareSync(password, row.password_hash)) {
        return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
    }
    req.session.userId = row.id;
    req.session.touch();
    return res.json({ user: safeUser(row) });
});

router.post('/logout', function logout(req, res) {
    req.session.destroy(function onDestroy(err) {
        if (err) return res.status(500).json({ error: 'Não foi possível encerrar a sessão.' });
        res.clearCookie('gympaquera.sid');
        return res.json({ ok: true });
    });
});

router.get('/me', requireAuth, function me(req, res) {
    const db = getDb();
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
    if (!row) {
        req.session.destroy();
        return res.status(401).json({ error: 'Sessão inválida.' });
    }
    const photos = db.prepare('SELECT path FROM photos WHERE user_id = ? ORDER BY sort_order').all(row.id);
    const user = safeUser(row);
    user.photos = photos.map(function (p) {
        return '/' + p.path.replace(/\\/g, '/');
    });
    return res.json({ user: user });
});

/** Recuperação de senha: placeholder (integrar e-mail/SMTP depois). */
router.post('/forgot', function forgot(_req, res) {
    return res.json({ ok: true, message: 'Se existir cadastro com este e-mail, enviaremos instruções em breve.' });
});

module.exports = router;
