const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { getDb, root } = require('../db');
const { requireAuth } = require('../middleware/requireAuth');
const { assertAdult, ageFromNascimento } = require('../userValidation');
const { isUserOnline } = require('../presence');
const { notifyNewFavorite } = require('../notifyEmail');
const { isBlocked } = require('../messageStore');

const router = express.Router();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: function (_req, file, cb) {
        if (!file.mimetype.startsWith('image/')) {
            cb(new Error('Envie apenas imagens.'));
            return;
        }
        cb(null, true);
    }
});

function publicProfile(row, photoPath) {
    const o = {
        id: row.id,
        publicUid: row.public_uid || null,
        nickname: row.nickname,
        gym: row.gym,
        cidade: row.cidade,
        estado: row.estado,
        sou: row.sou,
        procuro: row.procuro,
        photoUrl: photoPath ? normalizeUploadUrl(photoPath) : null
    };
    if (row.nascimento != null) {
        o.age = ageFromNascimento(row.nascimento);
    }
    return o;
}

function normalizeUploadUrl(raw) {
    if (raw == null || raw === '') return null;
    var s = String(raw).replace(/\\/g, '/').trim();
    if (!s) return null;
    if (/^https?:\/\//i.test(s)) return s;
    return '/' + s.replace(/^\/+/, '');
}

function photoRowsToUrls(rows) {
    if (!rows || !rows.length) return [];
    return rows
        .map(function (p) {
            if (!p) return null;
            var raw = p.path;
            if (raw === undefined || raw === null) raw = p.PATH;
            return normalizeUploadUrl(raw);
        })
        .filter(Boolean);
}

/** procuro: Mulheres | Homens | Casais | Todos → filtra por campo sou (Todos = sem filtro de tipo) */
router.get('/search', requireAuth, function search(req, res) {
    const db = getDb();
    const me = req.session.userId;
    const procuro = String(req.query.procuro || '').trim();
    const estado = String(req.query.estado || '').trim();
    const cidade = String(req.query.cidade || '').trim();

    if (!procuro || !estado) {
        return res.status(400).json({ error: 'Informe o que procura e o estado.' });
    }

    let souMatch = null;
    const p = procuro.toLowerCase();
    if (p === 'mulheres') souMatch = 'Mulher';
    else if (p === 'homens') souMatch = 'Homem';
    else if (p === 'casais') souMatch = 'Casal';
    else if (p === 'todos') souMatch = null;
    else return res.status(400).json({ error: 'Filtro inválido.' });

    const cidadeLike = '%' + cidade.replace(/%/g, '') + '%';
    const souClause = souMatch != null ? 'AND u.sou = ?' : '';
    const params = [me, estado, cidadeLike];
    if (souMatch != null) params.push(souMatch);
    params.push(me, me);

    const rows = db
        .prepare(
            `
        SELECT u.*,
            (SELECT p.path FROM photos p WHERE p.user_id = u.id ORDER BY p.sort_order LIMIT 1) AS photo_path
        FROM users u
        WHERE u.id != ?
          AND u.estado = ?
          AND LOWER(u.cidade) LIKE LOWER(?)
          ` +
            souClause +
            `
          AND u.id NOT IN (SELECT blocked_id FROM user_blocks WHERE blocker_id = ?)
          AND u.id NOT IN (SELECT blocker_id FROM user_blocks WHERE blocked_id = ?)
        ORDER BY u.nickname COLLATE NOCASE
        LIMIT 100
    `
        )
        .all(...params);

    const favRows = db.prepare('SELECT favorite_user_id FROM user_favorites WHERE user_id = ?').all(me);
    const favSet = new Set(favRows.map(function (r) { return r.favorite_user_id; }));

    var minAge = parseInt(String(req.query.minAge || ''), 10);
    var maxAge = parseInt(String(req.query.maxAge || ''), 10);
    var hasMin = Number.isFinite(minAge) && minAge > 0;
    var hasMax = Number.isFinite(maxAge) && maxAge > 0;
    /** Plataforma 18+: idade mínima do filtro nunca abaixo de 18 */
    if (hasMin) minAge = Math.max(18, minAge);
    if (hasMax && maxAge < 18) {
        return res.json({ results: [] });
    }

    var out = rows.map(function (r) {
        const card = publicProfile(r, r.photo_path);
        card.favorited = favSet.has(r.id);
        return card;
    });

    if (hasMin || hasMax) {
        out = out.filter(function (c) {
            var a = c.age;
            if (a == null) return false;
            if (hasMin && a < minAge) return false;
            if (hasMax && a > maxAge) return false;
            return true;
        });
    }

    return res.json({ results: out });
});

router.get('/presence', requireAuth, function presence(req, res) {
    const db = getDb();
    const raw = String(req.query.ids || '')
        .split(',')
        .map(function (x) {
            return parseInt(x.trim(), 10);
        })
        .filter(function (n) {
            return n > 0;
        })
        .slice(0, 40);
    if (!raw.length) return res.json({ users: {} });

    const uniq = [...new Set(raw)];
    const placeholders = uniq.map(function () {
        return '?';
    }).join(',');
    const rows = db.prepare('SELECT id, last_seen FROM users WHERE id IN (' + placeholders + ')').all(...uniq);
    const map = {};
    rows.forEach(function (r) {
        map[String(r.id)] = {
            online: isUserOnline(r.id),
            lastSeen: r.last_seen || null
        };
    });
    return res.json({ users: map });
});

router.patch('/me', requireAuth, express.json(), function patchMe(req, res) {
    const db = getDb();
    const me = req.session.userId;
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(me);
    if (!row) return res.status(404).json({ error: 'Usuário não encontrado.' });

    const b = req.body || {};
    const nickname = b.nickname != null ? String(b.nickname).trim() : row.nickname;
    const gym = b.gym != null ? String(b.gym).trim() : row.gym;
    const matricula = b.matricula != null ? String(b.matricula).trim() : row.matricula || '';
    const estado = b.estado != null ? String(b.estado).trim() : row.estado;
    const cidade = b.cidade != null ? String(b.cidade).trim() : row.cidade;
    const sou = b.sou != null ? String(b.sou).trim() : row.sou;
    const procuro = b.procuro != null ? String(b.procuro).trim() : row.procuro;
    let nascimento = b.nascimento != null ? String(b.nascimento).trim() : row.nascimento;

    if (!nickname || !gym || !matricula || !estado || !cidade || !sou || !procuro || !nascimento) {
        return res.status(400).json({ error: 'Campos obrigatórios não podem ficar vazios (incluindo matrícula ou ID).' });
    }
    if (nickname.length > 80) return res.status(400).json({ error: 'Apelido muito longo.' });
    if (gym.length > 120) return res.status(400).json({ error: 'Nome da academia muito longo.' });

    try {
        assertAdult(nascimento);
    } catch (e) {
        return res.status(400).json({ error: e.message });
    }

    const allowedSou = ['Homem', 'Mulher', 'Casal'];
    const allowedProc = ['Homens', 'Mulheres', 'Casais'];
    if (allowedSou.indexOf(sou) === -1) return res.status(400).json({ error: 'Valor inválido em “Eu sou”.' });
    if (allowedProc.indexOf(procuro) === -1) return res.status(400).json({ error: 'Valor inválido em “Procuro”.' });

    db.prepare(
        `UPDATE users SET nickname = ?, gym = ?, matricula = ?, estado = ?, cidade = ?, sou = ?, procuro = ?, nascimento = ?
         WHERE id = ?`
    ).run(nickname, gym, matricula || null, estado, cidade, sou, procuro, nascimento, me);

    const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(me);
    const photos = db.prepare('SELECT path FROM photos WHERE user_id = ? ORDER BY sort_order').all(me);
    const safe = (function () {
        const r = fresh;
        var until = r.premium_until || null;
        var active = false;
        if (until) {
            var d = new Date(until);
            if (!Number.isNaN(d.getTime()) && d > new Date()) active = true;
        }
        return {
            id: r.id,
            publicUid: r.public_uid || null,
            email: r.email,
            sou: r.sou,
            procuro: r.procuro,
            gym: r.gym,
            matricula: r.matricula,
            estado: r.estado,
            cidade: r.cidade,
            nickname: r.nickname,
            nascimento: r.nascimento,
            createdAt: r.created_at,
            premiumUntil: until,
            premiumActive: active,
            photos: photos.map(function (p) {
                return '/' + String(p.path).replace(/\\/g, '/');
            })
        };
    })();

    return res.json({ user: safe });
});

function photoListUrls(me, db) {
    const photoRows = db.prepare('SELECT path FROM photos WHERE user_id = ? ORDER BY sort_order, id').all(me);
    return photoRows.map(function (p) {
        return '/' + String(p.path).replace(/\\/g, '/');
    });
}

router.delete('/me/photos/:slot', requireAuth, function deleteMePhotoSlot(req, res) {
    const me = req.session.userId;
    const slot = parseInt(req.params.slot, 10);
    if (Number.isNaN(slot) || slot < 0 || slot > 2) {
        return res.status(400).json({ error: 'Posição inválida (use 0, 1 ou 2).' });
    }
    const db = getDb();
    try {
        const rows = db.prepare('SELECT id, path FROM photos WHERE user_id = ? ORDER BY sort_order, id').all(me);
        if (slot >= rows.length) {
            return res.status(404).json({ error: 'Não há foto nessa posição.' });
        }
        const row = rows[slot];
        fs.unlink(path.join(root, row.path), function () {});
        db.prepare('DELETE FROM photos WHERE id = ?').run(row.id);
        const rest = db.prepare('SELECT id FROM photos WHERE user_id = ? ORDER BY sort_order, id').all(me);
        rest.forEach(function (r, i) {
            db.prepare('UPDATE photos SET sort_order = ? WHERE id = ?').run(i, r.id);
        });
        return res.json({ photos: photoListUrls(me, db) });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: 'Erro ao excluir foto.' });
    }
});

router.post('/me/photos/:slot', requireAuth, upload.single('photo'), function postMePhotoSlot(req, res) {
    const me = req.session.userId;
    const slot = parseInt(req.params.slot, 10);
    if (Number.isNaN(slot) || slot < 0 || slot > 2) {
        return res.status(400).json({ error: 'Posição inválida (use 0, 1 ou 2).' });
    }
    const file = req.file;
    if (!file) {
        return res.status(400).json({ error: 'Envie uma imagem.' });
    }
    const db = getDb();
    try {
        const extMap = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
        const ext = extMap[file.mimetype] || '.img';
        const stamp = Date.now();
        const newRel = path.join('uploads', String(me) + '_' + stamp + '_s' + slot + ext).replace(/\\/g, '/');

        const rows = db.prepare('SELECT id, path FROM photos WHERE user_id = ? ORDER BY sort_order, id').all(me);

        if (rows[slot]) {
            const oldAbs = path.join(root, rows[slot].path);
            fs.writeFileSync(path.join(root, newRel), file.buffer);
            fs.unlink(oldAbs, function () {});
            db.prepare('UPDATE photos SET path = ? WHERE id = ?').run(newRel, rows[slot].id);
        } else {
            if (slot !== rows.length) {
                return res.status(400).json({
                    error:
                        'Adicione fotos na ordem (1ª, 2ª, 3ª) ou use Trocar em uma foto que já existe.'
                });
            }
            if (rows.length >= 3) {
                return res.status(400).json({ error: 'Limite de 3 fotos. Exclua uma antes de adicionar.' });
            }
            fs.writeFileSync(path.join(root, newRel), file.buffer);
            db.prepare('INSERT INTO photos (user_id, path, sort_order) VALUES (?, ?, ?)').run(me, newRel, slot);
        }
        const rest = db.prepare('SELECT id FROM photos WHERE user_id = ? ORDER BY sort_order, id').all(me);
        rest.forEach(function (r, i) {
            db.prepare('UPDATE photos SET sort_order = ? WHERE id = ?').run(i, r.id);
        });
        return res.json({ photos: photoListUrls(me, db) });
    } catch (e) {
        if (e && e.message === 'Envie apenas imagens.') {
            return res.status(400).json({ error: e.message });
        }
        console.error(e);
        return res.status(500).json({ error: 'Erro ao salvar foto.' });
    }
});

router.post('/me/photos', requireAuth, upload.array('photos', 3), function postMePhotos(req, res) {
    const me = req.session.userId;
    const files = req.files || [];
    if (!files.length) {
        return res.status(400).json({ error: 'Envie de 1 a 3 imagens.' });
    }
    const db = getDb();
    try {
        const oldRows = db.prepare('SELECT path FROM photos WHERE user_id = ?').all(me);
        oldRows.forEach(function (r) {
            fs.unlink(path.join(root, r.path), function () {});
        });
        db.prepare('DELETE FROM photos WHERE user_id = ?').run(me);
        const extMap = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
        const stamp = Date.now();
        files.forEach(function (file, i) {
            const ext = extMap[file.mimetype] || '.img';
            const rel = path.join('uploads', String(me) + '_' + stamp + '_' + i + ext).replace(/\\/g, '/');
            fs.writeFileSync(path.join(root, rel), file.buffer);
            db.prepare('INSERT INTO photos (user_id, path, sort_order) VALUES (?, ?, ?)').run(me, rel, i);
        });
        return res.json({ photos: photoListUrls(me, db) });
    } catch (e) {
        if (e && e.message === 'Envie apenas imagens.') {
            return res.status(400).json({ error: e.message });
        }
        console.error(e);
        return res.status(500).json({ error: 'Erro ao salvar fotos.' });
    }
});

router.get('/favorites', requireAuth, function listFavorites(req, res) {
    const db = getDb();
    const me = req.session.userId;
    const rows = db
        .prepare(
            `
        SELECT u.id, u.nickname, u.gym, u.cidade, u.public_uid,
          (SELECT p.path FROM photos p WHERE p.user_id = u.id ORDER BY p.sort_order LIMIT 1) AS photo_path
        FROM user_favorites f
        JOIN users u ON u.id = f.favorite_user_id
        WHERE f.user_id = ?
        ORDER BY u.nickname COLLATE NOCASE
    `
        )
        .all(me);

    const list = rows.map(function (r) {
        return {
            id: r.id,
            publicUid: r.public_uid || null,
            nickname: r.nickname,
            gym: r.gym,
            cidade: r.cidade,
            photoUrl: r.photo_path ? '/' + String(r.photo_path).replace(/\\/g, '/') : null
        };
    });
    return res.json({ favorites: list });
});

router.get('/blocks', requireAuth, function listBlocks(req, res) {
    const db = getDb();
    const me = req.session.userId;
    const rows = db
        .prepare(
            `
        SELECT u.id, u.nickname, u.gym
        FROM user_blocks b
        JOIN users u ON u.id = b.blocked_id
        WHERE b.blocker_id = ?
        ORDER BY u.nickname COLLATE NOCASE
    `
        )
        .all(me);
    return res.json({ blocked: rows });
});

router.post('/favorites/:id', requireAuth, function addFavorite(req, res) {
    const db = getDb();
    const me = req.session.userId;
    const id = parseInt(req.params.id, 10);
    if (!id || id === me) return res.status(400).json({ error: 'Usuário inválido.' });
    const target = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });
    if (isBlocked(me, id)) return res.status(403).json({ error: 'Não é possível favoritar este usuário.' });

    try {
        db.prepare('INSERT INTO user_favorites (user_id, favorite_user_id, created_at) VALUES (?, ?, ?)').run(
            me,
            id,
            new Date().toISOString()
        );
    } catch (e) {
        if (e.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
            return res.status(200).json({ ok: true });
        }
        throw e;
    }
    const meRow = db.prepare('SELECT nickname FROM users WHERE id = ?').get(me);
    const toRow = db.prepare('SELECT email FROM users WHERE id = ?').get(id);
    setImmediate(function () {
        try {
            notifyNewFavorite(id, toRow && toRow.email, meRow && meRow.nickname);
        } catch (e2) {}
    });
    return res.status(201).json({ ok: true });
});

router.delete('/favorites/:id', requireAuth, function removeFavorite(req, res) {
    const db = getDb();
    const me = req.session.userId;
    const id = parseInt(req.params.id, 10);
    db.prepare('DELETE FROM user_favorites WHERE user_id = ? AND favorite_user_id = ?').run(me, id);
    return res.json({ ok: true });
});

router.post('/blocks/:id', requireAuth, function block(req, res) {
    const db = getDb();
    const me = req.session.userId;
    const id = parseInt(req.params.id, 10);
    if (!id || id === me) return res.status(400).json({ error: 'Usuário inválido.' });
    const target = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });

    try {
        db.prepare('INSERT INTO user_blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)').run(
            me,
            id,
            new Date().toISOString()
        );
    } catch (e) {
        if (e.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
            return res.status(200).json({ ok: true });
        }
        throw e;
    }
    db.prepare(
        'DELETE FROM user_favorites WHERE (user_id = ? AND favorite_user_id = ?) OR (user_id = ? AND favorite_user_id = ?)'
    ).run(me, id, id, me);
    return res.status(201).json({ ok: true });
});

router.delete('/blocks/:id', requireAuth, function unblock(req, res) {
    const db = getDb();
    const me = req.session.userId;
    const id = parseInt(req.params.id, 10);
    db.prepare('DELETE FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?').run(me, id);
    return res.json({ ok: true });
});

router.delete('/account', requireAuth, function deleteAccount(req, res) {
    const db = getDb();
    const me = req.session.userId;
    const rows = db.prepare('SELECT path FROM photos WHERE user_id = ?').all(me);
    rows.forEach(function (r) {
        const abs = path.join(root, r.path);
        fs.unlink(abs, function () {});
    });
    db.prepare('DELETE FROM users WHERE id = ?').run(me);
    req.session.destroy(function (err) {
        if (err) return res.status(500).json({ error: 'Conta removida mas a sessão falhou ao encerrar.' });
        res.clearCookie('gympaquera.sid');
        return res.json({ ok: true });
    });
});

router.get('/profile/:id', requireAuth, function getUser(req, res) {
    const db = getDb();
    const me = req.session.userId;
    const id = parseInt(req.params.id, 10);
    if (!id || id === me) return res.status(404).json({ error: 'Perfil não encontrado.' });

    if (isBlocked(me, id)) return res.status(403).json({ error: 'Você não pode ver este perfil.' });

    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: 'Perfil não encontrado.' });

    const photoRows = db.prepare('SELECT path FROM photos WHERE user_id = ? ORDER BY sort_order').all(id);
    var photoUrls = photoRowsToUrls(photoRows);
    var firstPath = photoRows[0] ? photoRows[0].path || photoRows[0].PATH : null;
    const profile = publicProfile(row, firstPath);
    profile.photos = photoUrls;
    if (!profile.photos.length && profile.photoUrl) {
        profile.photos = [profile.photoUrl];
    }
    return res.json({ profile: profile });
});

module.exports = router;
