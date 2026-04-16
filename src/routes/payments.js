const express = require('express');
const crypto = require('crypto');
const { getDb } = require('../db');
const { requireAuth } = require('../middleware/requireAuth');

const router = express.Router();

/** Checkout é sempre via navegador (form POST). Sem sessão → login, nunca iniciar pagamento “por fora”. */
function requireAuthOrRedirectLogin(req, res, next) {
    if (!req.session || !req.session.userId) {
        return res.redirect(303, '/login.html?next=' + encodeURIComponent('/mypay.html'));
    }
    next();
}

function mpAccessToken() {
    var t = process.env.MERCADOPAGO_ACCESS_TOKEN;
    if (!t || !String(t).trim()) return null;
    return String(t).trim();
}

function monthlyPriceBrl() {
    var n = parseFloat(process.env.PREMIUM_PRICE_BRL || '9.9', 10);
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 9.9;
}

function premiumDays() {
    var d = parseInt(process.env.PREMIUM_DAYS || '30', 10);
    return Number.isFinite(d) && d > 0 ? d : 30;
}

/** Valor exibido na página de planos (sem credencial). */
router.get('/info', function paymentInfo(_req, res) {
    res.json({
        priceBrl: monthlyPriceBrl(),
        currency: 'BRL',
        premiumDays: premiumDays(),
        method: 'checkout_pro',
        provider: 'mercado_pago'
    });
});

function addPremiumDays(db, userId, days) {
    var row = db.prepare('SELECT premium_until FROM users WHERE id = ?').get(userId);
    var base = new Date();
    if (row && row.premium_until) {
        var cur = new Date(row.premium_until);
        if (!Number.isNaN(cur.getTime()) && cur > base) base = cur;
    }
    base.setUTCDate(base.getUTCDate() + days);
    db.prepare('UPDATE users SET premium_until = ? WHERE id = ?').run(base.toISOString(), userId);
}

async function mpGetPayment(paymentId) {
    var token = mpAccessToken();
    if (!token) throw new Error('MERCADOPAGO_ACCESS_TOKEN não configurado.');
    var r = await fetch('https://api.mercadopago.com/v1/payments/' + encodeURIComponent(String(paymentId)), {
        headers: { Authorization: 'Bearer ' + token }
    });
    var data = await r.json();
    if (!r.ok) {
        var msg = data && (data.message || data.error) ? String(data.message || data.error) : 'Erro Mercado Pago';
        var err = new Error(msg);
        err.status = r.status;
        throw err;
    }
    return data;
}

function parseUserIdFromPayment(payment) {
    var ext = payment.external_reference != null ? String(payment.external_reference) : '';
    var m = /^gympaquera:(\d+):/.exec(ext);
    if (m) return parseInt(m[1], 10);
    if (payment.metadata && payment.metadata.user_id != null) {
        var n = parseInt(String(payment.metadata.user_id), 10);
        if (n) return n;
    }
    return null;
}

/**
 * Registra ou atualiza linha em pix_charges e estende premium quando o MP aprova (idempotente).
 * Cobre Checkout Pro (pagamento criado depois) e API direta de Pix.
 */
function upsertPaymentAndGrant(db, payment) {
    var idStr = String(payment.id);
    var st = String(payment.status || 'pending');
    var amount = Number(payment.transaction_amount);
    if (!Number.isFinite(amount)) amount = monthlyPriceBrl();
    var ext = payment.external_reference != null ? String(payment.external_reference) : null;

    var row = db.prepare('SELECT user_id, status FROM pix_charges WHERE mp_payment_id = ?').get(idStr);

    if (!row) {
        var userId = parseUserIdFromPayment(payment);
        if (!userId) {
            console.warn('[mp] pagamento', idStr, 'sem usuário (external_reference/metadata)');
            return payment;
        }
        try {
            db.prepare(
                `INSERT INTO pix_charges (user_id, mp_payment_id, status, amount, external_reference, created_at)
                 VALUES (?, ?, ?, ?, ?, ?)`
            ).run(userId, idStr, st, amount, ext, new Date().toISOString());
            if (st === 'approved') addPremiumDays(db, userId, premiumDays());
            return payment;
        } catch (e) {
            if (!e || e.code !== 'SQLITE_CONSTRAINT_UNIQUE') throw e;
            row = db.prepare('SELECT user_id, status FROM pix_charges WHERE mp_payment_id = ?').get(idStr);
            if (!row) return payment;
        }
    }

    var was = row.status;
    if (st === 'approved' && was !== 'approved') {
        db.prepare('UPDATE pix_charges SET status = ? WHERE mp_payment_id = ?').run('approved', idStr);
        addPremiumDays(db, row.user_id, premiumDays());
    } else if (was !== st) {
        db.prepare('UPDATE pix_charges SET status = ? WHERE mp_payment_id = ?').run(st, idStr);
    }
    return payment;
}

async function syncPaymentFromMp(db, paymentId) {
    var payment = await mpGetPayment(paymentId);
    upsertPaymentAndGrant(db, payment);
    return payment;
}

/** URL pública do site (back_urls e documentação). Preferir APP_PUBLIC_URL em produção. */
function publicOrigin(req) {
    var base = process.env.APP_PUBLIC_URL;
    if (base && String(base).trim()) return String(base).trim().replace(/\/$/, '');
    var proto = (req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim();
    var host = req.get('host');
    if (!host) return 'http://localhost:' + (process.env.PORT || 3000);
    return proto + '://' + host;
}

function mpPreferenceInitPoint(pref) {
    var token = mpAccessToken() || '';
    var isTest = /^TEST-/.test(token) || String(process.env.MERCADOPAGO_SANDBOX || '').toLowerCase() === 'true';
    if (isTest) return pref.sandbox_init_point || pref.init_point;
    return pref.init_point || pref.sandbox_init_point;
}

/**
 * Checkout Pro (oficial): usuário paga no fluxo hospedado do Mercado Pago (Pix, cartão, etc.).
 */
async function createCheckoutProForSessionUser(req) {
    var token = mpAccessToken();
    if (!token) {
        var err0 = new Error(
            'Mercado Pago não configurado. Defina MERCADOPAGO_ACCESS_TOKEN no servidor (credencial de produção ou teste).'
        );
        err0.status = 503;
        throw err0;
    }
    var db = getDb();
    var userId = req.session.userId;
    var user = db.prepare('SELECT id, email FROM users WHERE id = ?').get(userId);
    if (!user) {
        var err1 = new Error('Sessão inválida.');
        err1.status = 401;
        throw err1;
    }

    var amount = monthlyPriceBrl();
    var externalRef = 'gympaquera:' + userId + ':' + Date.now();
    var origin = publicOrigin(req);
    var wh = process.env.MERCADOPAGO_WEBHOOK_URL;

    var payload = {
        items: [
            {
                title: 'Gym Paquera — Plano mensal (chat)',
                description: 'Uso do chat na plataforma por ' + premiumDays() + ' dias.',
                quantity: 1,
                unit_price: amount,
                currency_id: 'BRL'
            }
        ],
        payer: { email: user.email },
        back_urls: {
            success: origin + '/mypay.html?mp=retorno&st=aprovado',
            failure: origin + '/mypay.html?mp=retorno&st=recusado',
            pending: origin + '/mypay.html?mp=retorno&st=pendente'
        },
        auto_return: 'approved',
        external_reference: externalRef,
        metadata: { user_id: String(userId) }
    };
    if (wh && String(wh).trim()) payload.notification_url = String(wh).trim();

    var r = await fetch('https://api.mercadopago.com/checkout/preferences', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + token
        },
        body: JSON.stringify(payload)
    });
    var pref = await r.json();
    if (!r.ok) {
        var msg =
            pref.message ||
            (pref.cause && pref.cause[0] && pref.cause[0].description) ||
            'Falha ao criar checkout no Mercado Pago.';
        console.error('[checkout pro]', pref);
        var err2 = new Error(String(msg));
        err2.status = 400;
        throw err2;
    }

    var initPoint = mpPreferenceInitPoint(pref);
    if (!initPoint) {
        var err3 = new Error('Mercado Pago não retornou URL de checkout (init_point).');
        err3.status = 502;
        throw err3;
    }

    return { initPoint: initPoint, preferenceId: pref.id };
}

function pixPresentationFromPayment(payment) {
    var td =
        payment.point_of_interaction && payment.point_of_interaction.transaction_data
            ? payment.point_of_interaction.transaction_data
            : null;
    return {
        qrCode: td && td.qr_code ? td.qr_code : null,
        qrCodeBase64: td && td.qr_code_base64 ? td.qr_code_base64 : null,
        ticketUrl: td && td.ticket_url ? String(td.ticket_url).trim() : null
    };
}

/**
 * Cria cobrança Pix no MP e registra em pix_charges.
 * @returns {Promise<{ paymentId: string|number, status: string, amount: number, qrCode: string|null, qrCodeBase64: string|null, ticketUrl: string|null }>}
 */
async function createPixChargeForSessionUser(req) {
    var token = mpAccessToken();
    if (!token) {
        var err0 = new Error(
            'Pix não configurado. No servidor, defina MERCADOPAGO_ACCESS_TOKEN (credencial de produção ou teste do Mercado Pago).'
        );
        err0.status = 503;
        throw err0;
    }
    var db = getDb();
    var userId = req.session.userId;
    var user = db.prepare('SELECT id, email FROM users WHERE id = ?').get(userId);
    if (!user) {
        var err1 = new Error('Sessão inválida.');
        err1.status = 401;
        throw err1;
    }

    var amount = monthlyPriceBrl();
    var idempotency = crypto.randomUUID();
    var externalRef = 'gympaquera:' + userId + ':' + Date.now();

    var payload = {
        transaction_amount: amount,
        description: 'Gym Paquera — Premium mensal',
        payment_method_id: 'pix',
        payer: { email: user.email },
        external_reference: externalRef
    };
    var wh = process.env.MERCADOPAGO_WEBHOOK_URL;
    if (wh && String(wh).trim()) payload.notification_url = String(wh).trim();

    var r = await fetch('https://api.mercadopago.com/v1/payments', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + token,
            'X-Idempotency-Key': idempotency
        },
        body: JSON.stringify(payload)
    });
    var payment = await r.json();
    if (!r.ok) {
        var msg = payment.message || (payment.cause && payment.cause[0] && payment.cause[0].description) || 'Falha ao criar Pix.';
        console.error('[pix create]', payment);
        var err2 = new Error(String(msg));
        err2.status = 400;
        throw err2;
    }

    var pres = pixPresentationFromPayment(payment);

    db.prepare(
        `INSERT INTO pix_charges (user_id, mp_payment_id, status, amount, external_reference, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
        userId,
        String(payment.id),
        String(payment.status || 'pending'),
        amount,
        externalRef,
        new Date().toISOString()
    );

    return {
        paymentId: payment.id,
        status: String(payment.status || 'pending'),
        amount: amount,
        qrCode: pres.qrCode,
        qrCodeBase64: pres.qrCodeBase64,
        ticketUrl: pres.ticketUrl
    };
}

/** JSON (ex.: apps); preferir /pix/checkout para levar o usuário ao site do Mercado Pago. */
router.post('/pix', requireAuth, async function createPix(req, res) {
    try {
        var out = await createPixChargeForSessionUser(req);
        return res.json(out);
    } catch (e) {
        console.error(e);
        var status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
        return res.status(status).json({ error: e.message || 'Erro ao gerar Pix.' });
    }
});

/**
 * Checkout Pro: redireciona para o fluxo oficial do Mercado Pago (Pix, cartão, saldo, etc.).
 */
router.post('/pix/checkout', requireAuthOrRedirectLogin, async function checkoutProStart(req, res) {
    try {
        var out = await createCheckoutProForSessionUser(req);
        return res.redirect(303, out.initPoint);
    } catch (e) {
        console.error(e);
        var msg = encodeURIComponent(e.message || 'Erro ao iniciar pagamento.');
        var code = e.status === 503 ? 'config' : e.status === 401 ? 'auth' : 'fail';
        return res.redirect(303, '/mypay.html?checkoutError=' + msg + '&code=' + code);
    }
});

/** Dados de exibição Pix para uma cobrança já criada (fallback quando não há ticket_url). */
router.get('/pix/:paymentId/receipt', requireAuth, async function pixReceipt(req, res) {
    try {
        var db = getDb();
        var pid = String(req.params.paymentId);
        var row = db.prepare('SELECT user_id FROM pix_charges WHERE mp_payment_id = ?').get(pid);
        if (!row || row.user_id !== req.session.userId) {
            return res.status(403).json({ error: 'Cobrança não encontrada ou não pertence à sua conta.' });
        }
        var payment = await mpGetPayment(pid);
        var pres = pixPresentationFromPayment(payment);
        return res.json({
            paymentId: payment.id,
            status: payment.status,
            qrCode: pres.qrCode,
            qrCodeBase64: pres.qrCodeBase64,
            ticketUrl: pres.ticketUrl
        });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: e.message || 'Erro ao carregar cobrança.' });
    }
});

router.get('/pix/:paymentId/status', requireAuth, async function pixStatus(req, res) {
    try {
        var db = getDb();
        var pid = String(req.params.paymentId);
        var row = db.prepare('SELECT user_id FROM pix_charges WHERE mp_payment_id = ?').get(pid);
        if (!row || row.user_id !== req.session.userId) {
            return res.status(403).json({ error: 'Cobrança não encontrada ou não pertence à sua conta.' });
        }
        var payment = await syncPaymentFromMp(db, pid);
        var urow = db.prepare('SELECT premium_until FROM users WHERE id = ?').get(req.session.userId);
        var active = false;
        if (urow && urow.premium_until) {
            var d = new Date(urow.premium_until);
            if (!Number.isNaN(d.getTime()) && d > new Date()) active = true;
        }
        return res.json({
            status: payment.status,
            premiumActive: active,
            premiumUntil: urow ? urow.premium_until : null
        });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: e.message || 'Erro ao consultar pagamento.' });
    }
});

function extractNotificationId(body, query) {
    if (body && body.data && body.data.id != null) return String(body.data.id);
    if (query && query['data.id'] != null) return String(query['data.id']);
    if (query && query.id != null) return String(query.id);
    return null;
}

/** Webhook Mercado Pago (configure a URL pública HTTPS em produção). */
router.post('/webhook', function webhook(req, res) {
    res.status(200).send('OK');
    var id = extractNotificationId(req.body, req.query);
    if (!id) return;

    setImmediate(function () {
        try {
            var db = getDb();
            syncPaymentFromMp(db, id).catch(function (err) {
                console.error('[pix webhook]', id, err && err.message ? err.message : err);
            });
        } catch (e) {
            console.error('[pix webhook]', e);
        }
    });
});

module.exports = router;
