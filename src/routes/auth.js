const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { getDb, root } = require('../db');
const { requireAuth } = require('../middleware/requireAuth');
const { assertAdult } = require('../userValidation');
const { notifyPasswordReset } = require('../notifyEmail');

const router = express.Router();

/** Aceita DD/MM/AAAA ou AAAA-MM-DD; retorna sempre AAAA-MM-DD. */
function normalizeBirthdateInput(raw) {
    const s = String(raw || '').trim();
    const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    if (br) {
        const d = parseInt(br[1], 10);
        const m = parseInt(br[2], 10);
        const y = parseInt(br[3], 10);
        if (m < 1 || m > 12 || d < 1 || d > 31) {
            throw new Error('Data de nascimento inválida.');
        }
        const dt = new Date(y, m - 1, d, 12, 0, 0);
        if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) {
            throw new Error('Data de nascimento inválida.');
        }
        return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (iso) {
        const y = parseInt(iso[1], 10);
        const m = parseInt(iso[2], 10);
        const d = parseInt(iso[3], 10);
        const dt = new Date(y, m - 1, d, 12, 0, 0);
        if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) {
            throw new Error('Data de nascimento inválida.');
        }
        return s;
    }
    throw new Error('Informe a data de nascimento no formato DD/MM/AAAA.');
}

function publicOrigin(req) {
    var base = process.env.APP_PUBLIC_URL;
    if (base && String(base).trim()) return String(base).trim().replace(/\/$/, '');
    var proto = (req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim();
    var host = req.get('host');
    if (!host) return 'http://localhost:' + (process.env.PORT || 3000);
    return proto + '://' + host;
}
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
        if (!sou || !procuro || !gym || !matricula || !estado || !cidade || !nickname || !nascimento) {
            return res.status(400).json({ error: 'Preencha todos os campos obrigatórios (incluindo ID da matrícula).' });
        }

        let nascimentoNorm;
        try {
            nascimentoNorm = normalizeBirthdateInput(nascimento);
        } catch (e) {
            return res.status(400).json({ error: e.message || 'Data de nascimento inválida.' });
        }

        assertAdult(nascimentoNorm);

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
                matricula,
                estado,
                cidade,
                nickname,
                nascimentoNorm,
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

/** Esqueci a senha: gera token e envia e-mail (SMTP obrigatório para o link chegar). */
router.post('/forgot', function forgot(req, res) {
    const email = String(req.body.email || '').trim().toLowerCase();
    const generic = {
        ok: true,
        message:
            'Se existir cadastro com este e-mail, você receberá um link para redefinir a senha em alguns minutos. Verifique também a pasta de spam.'
    };
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.json(generic);
    }
    const db = getDb();
    const row = db.prepare('SELECT id, email FROM users WHERE email = ?').get(email);
    if (!row) {
        return res.json(generic);
    }
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken, 'utf8').digest('hex');
    const now = new Date();
    const expires = new Date(now.getTime() + 60 * 60 * 1000);
    try {
        db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(row.id);
        db.prepare(
            'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)'
        ).run(row.id, tokenHash, expires.toISOString(), now.toISOString());
    } catch (e) {
        console.error('[auth/forgot]', e);
        return res.json(generic);
    }
    const resetUrl = publicOrigin(req) + '/redefinir-senha.html?token=' + encodeURIComponent(rawToken);
    notifyPasswordReset(row.email, resetUrl)
        .then(function (sent) {
            if (!sent) {
                try {
                    db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(row.id);
                } catch (e) {}
                console.warn('[auth/forgot] E-mail não enviado (configure SMTP_HOST e credenciais no .env).');
            }
            res.json(generic);
        })
        .catch(function (err) {
            console.warn('[auth/forgot]', err && err.message ? err.message : err);
            try {
                db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(row.id);
            } catch (e) {}
            res.json(generic);
        });
});

router.post('/reset-password', function resetPassword(req, res) {
    const rawToken = String(req.body.token || '').trim();
    const password = String(req.body.password || '');
    if (!rawToken || password.length < 6) {
        return res.status(400).json({ error: 'Link inválido ou expirado, ou senha com menos de 6 caracteres.' });
    }
    const tokenHash = crypto.createHash('sha256').update(rawToken, 'utf8').digest('hex');
    const nowIso = new Date().toISOString();
    const db = getDb();
    const tok = db
        .prepare(
            'SELECT user_id FROM password_reset_tokens WHERE token_hash = ? AND expires_at > ?'
        )
        .get(tokenHash, nowIso);
    if (!tok) {
        return res.status(400).json({ error: 'Link inválido ou expirado. Solicite um novo e-mail em Esqueceu a senha.' });
    }
    const passwordHash = bcrypt.hashSync(password, 10);
    const run = db.transaction(function () {
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, tok.user_id);
        db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(tok.user_id);
    });
    try {
        run();
    } catch (e) {
        console.error('[auth/reset-password]', e);
        return res.status(500).json({ error: 'Não foi possível atualizar a senha.' });
    }
    return res.json({ ok: true, message: 'Senha atualizada. Você já pode entrar com a nova senha.' });
});

module.exports = router;
