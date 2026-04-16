const { insertMessage } = require('./messageStore');
const { getDb } = require('./db');
const { notifyNewMessage } = require('./notifyEmail');
const { isPremiumActive } = require('./premiumAccess');

/** @type {import('socket.io').Server | null} */
var ioRef = null;

function setIo(io) {
    ioRef = io;
}

/**
 * @returns {{ message: object } | { error: string, code?: string }}
 */
function sendChatMessage(fromUserId, toUserId, bodyRaw) {
    var db = getDb();
    if (!isPremiumActive(db, fromUserId)) {
        return {
            error: 'Para enviar mensagens, ative o seu plano.',
            code: 'PAYMENT_REQUIRED'
        };
    }
    var result = insertMessage(fromUserId, toUserId, bodyRaw);
    if (result.message && ioRef) {
        var msg = result.message;
        var nickRow = db.prepare('SELECT nickname FROM users WHERE id = ?').get(msg.from_user_id);
        var senderNickname = nickRow && nickRow.nickname ? nickRow.nickname : '';
        ioRef.to('user:' + msg.from_user_id).to('user:' + msg.to_user_id).emit('chat:new', {
            message: msg,
            senderNickname: senderNickname
        });
        setImmediate(function () {
            try {
                var toRow = db.prepare('SELECT email FROM users WHERE id = ?').get(msg.to_user_id);
                if (toRow && toRow.email) {
                    notifyNewMessage(msg.to_user_id, toRow.email, senderNickname, msg.body);
                }
            } catch (e) {}
        });
    }
    return result;
}

module.exports = { setIo, sendChatMessage };
