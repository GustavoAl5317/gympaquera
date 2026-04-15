const { sendChatMessage } = require('./chatDispatch');
const { onSocketConnect, onSocketDisconnect } = require('./presence');

/**
 * @param {import('socket.io').Server} io
 * @param {import('express-session').RequestHandler} sessionMiddleware
 */
function attachSocketChat(io, sessionMiddleware) {
    const wrap = function (middleware) {
        return function (socket, next) {
            middleware(socket.request, {}, next);
        };
    };

    io.use(wrap(sessionMiddleware));

    io.on('connection', function (socket) {
        const sess = socket.request.session;
        if (!sess || !sess.userId) {
            socket.disconnect(true);
            return;
        }

        var userId = sess.userId;
        socket.join('user:' + userId);
        socket.data.userId = userId;

        onSocketConnect(io, userId);

        socket.on('chat:send', function (payload, ack) {
            var toUserId = parseInt(payload && payload.toUserId, 10);
            var body = payload && payload.body;

            try {
                var result = sendChatMessage(userId, toUserId, body);
                if (result.error) {
                    if (typeof ack === 'function') {
                        ack({ error: result.error, code: result.code || undefined });
                    }
                    return;
                }
                if (typeof ack === 'function') ack({ ok: true });
            } catch (err) {
                if (typeof ack === 'function') ack({ error: err.message || 'Erro' });
            }
        });

        socket.on('chat:typing', function (payload) {
            var toUserId = parseInt(payload && payload.toUserId, 10);
            var typing = !!(payload && payload.typing);
            if (!toUserId || toUserId === userId) return;
            io.to('user:' + toUserId).emit('chat:typing', {
                fromUserId: userId,
                typing: typing
            });
        });

        socket.on('disconnect', function () {
            onSocketDisconnect(io, userId);
        });
    });
}

module.exports = { attachSocketChat };
