/**
 * E-mails opcionais (configure SMTP_* / MAIL_FROM no ambiente).
 * Falhas são logadas; nunca quebram o fluxo principal.
 */

let transporter = null;

function getTransporter() {
    if (transporter) return transporter;
    const host = process.env.SMTP_HOST;
    if (!host || !String(host).trim()) return null;
    const nodemailer = require('nodemailer');
    const port = parseInt(process.env.SMTP_PORT || '587', 10);
    const secure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465;
    transporter = nodemailer.createTransport({
        host: String(host).trim(),
        port: port,
        secure: secure,
        auth: process.env.SMTP_USER
            ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' }
            : undefined
    });
    return transporter;
}

function mailFrom() {
    return process.env.MAIL_FROM || process.env.SMTP_USER || 'noreply@gympaquera.local';
}

function appPublicName() {
    return process.env.APP_PUBLIC_NAME || 'Gym Paquera';
}

function sendMail(opts) {
    const t = getTransporter();
    if (!t) return Promise.resolve(false);
    return t
        .sendMail({
            from: mailFrom(),
            to: opts.to,
            subject: opts.subject,
            text: opts.text,
            html: opts.html
        })
        .then(function () {
            return true;
        })
        .catch(function (err) {
            console.warn('[mail]', err && err.message ? err.message : err);
            return false;
        });
}

function notifyNewMessage(toUserId, toEmail, fromNickname, preview) {
    if (!toEmail) return;
    const name = appPublicName();
    const body = String(preview || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    sendMail({
        to: toEmail,
        subject: name + ' — nova mensagem de ' + (fromNickname || 'alguém'),
        text:
            'Você recebeu uma nova mensagem no ' +
            name +
            '.\n\n' +
            (fromNickname ? 'De: ' + fromNickname + '\n' : '') +
            (body ? 'Prévia: ' + body + '\n' : '') +
            '\nAbra o site para responder.',
        html:
            '<p>Você recebeu uma nova mensagem no <strong>' +
            escHtml(name) +
            '</strong>.</p>' +
            (fromNickname ? '<p>De: <strong>' + escHtml(fromNickname) + '</strong></p>' : '') +
            (body ? '<p style="color:#555;">' + escHtml(body) + '</p>' : '') +
            '<p>Abra o site para responder.</p>'
    });
}

function notifyNewFavorite(toUserId, toEmail, fromNickname) {
    if (!toEmail) return;
    const name = appPublicName();
    sendMail({
        to: toEmail,
        subject: name + ' — alguém favoritou seu perfil',
        text:
            (fromNickname || 'Um usuário') +
            ' adicionou você aos favoritos no ' +
            name +
            '. Abra o site para ver.',
        html:
            '<p><strong>' +
            escHtml(fromNickname || 'Um usuário') +
            '</strong> adicionou você aos favoritos no <strong>' +
            escHtml(name) +
            '</strong>.</p><p>Abra o site para ver.</p>'
    });
}

function escHtml(s) {
    return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

module.exports = { notifyNewMessage, notifyNewFavorite };
