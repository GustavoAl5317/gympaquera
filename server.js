require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const session = require('express-session');
const { Server } = require('socket.io');
const cookieParser = require('cookie-parser');

const { getDb } = require('./src/db');
const authRoutes = require('./src/routes/auth');
const usersRoutes = require('./src/routes/users');
const messagesRoutes = require('./src/routes/messages');
const reportsRoutes = require('./src/routes/reports');
const paymentsRoutes = require('./src/routes/payments');
const { setIo } = require('./src/chatDispatch');
const { attachSocketChat } = require('./src/socketChat');

const root = __dirname;
const uploadsDir = path.join(root, 'uploads');
try {
    if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
    }
} catch (err) {
    console.error('[uploads] Crie a pasta uploads com permissão de escrita:', err.message);
    process.exit(1);
}

getDb();

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

/** Atrás de Nginx/Caddy (HTTPS): necessário para cookie seguro e IP real. */
if (isProduction || process.env.TRUST_PROXY === '1') {
    app.set('trust proxy', 1);
}

const sessionMiddleware = session({
    name: 'gympaquera.sid',
    secret: process.env.SESSION_SECRET || 'defina_SESSION_SECRET_em_producao',
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        maxAge: 7 * 24 * 60 * 60 * 1000,
        sameSite: 'lax',
        secure: isProduction
    }
});

app.disable('x-powered-by');
app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(sessionMiddleware);

app.use('/uploads', express.static(path.join(root, 'uploads')));

app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/messages', messagesRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/payments', paymentsRoutes);

/** Página de pagamento só com sessão — não dá para abrir /mypay “por fora” do login. */
app.use(function requireSessionForMypayPage(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    var p = req.path || '';
    var isMypay = p === '/mypay.html' || p === '/mypay' || /^\/mypay\/$/i.test(p);
    if (!isMypay) return next();
    if (!req.session || !req.session.userId) {
        var qi = req.originalUrl.indexOf('?');
        var tail = qi >= 0 ? req.originalUrl.slice(qi) : '';
        return res.redirect(303, '/login.html?next=' + encodeURIComponent('/mypay.html' + tail));
    }
    next();
});

app.use(express.static(path.join(root, 'public'), { extensions: ['html'], index: ['index.html'] }));

app.use(function notFound(req, res, next) {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'Rota não encontrada.' });
    }
    return res.status(404).send('Página não encontrada');
});

app.use(function errHandler(err, _req, res, _next) {
    console.error(err);
    var status = Number(err.statusCode || err.status) || 500;
    if (status < 400 || status > 599) status = 500;
    var msg = status >= 500 ? 'Erro interno do servidor.' : (err.message || 'Requisição inválida.');
    res.status(status).json({ error: msg });
});

const httpServer = http.createServer(app);

const io = new Server(httpServer, {
    path: '/socket.io',
    cors: { origin: false }
});

setIo(io);
attachSocketChat(io, sessionMiddleware);

httpServer.listen(PORT, function () {
    console.log('Gym Paquera rodando em http://localhost:' + PORT);
    console.log('Chat em tempo real (Socket.IO) no mesmo endereço.');
});

httpServer.on('error', function (err) {
    if (err && err.code === 'EADDRINUSE') {
        console.error('');
        console.error('A porta', PORT, 'já está em uso (outro Node/servidor rodando?).');
        console.error('Opções:');
        console.error('  1) Encerre o processo que usa a porta, ou');
        console.error('  2) Use outra porta:  $env:PORT=3001; npm start   (PowerShell)');
        console.error('');
        process.exit(1);
    }
    throw err;
});
