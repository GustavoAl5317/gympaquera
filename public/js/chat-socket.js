(function () {
    var socket = null;
    var messageListeners = [];
    var typingListeners = [];
    var presenceListeners = [];
    var connectPromise = null;

    function ensureIo() {
        if (typeof io === 'undefined') {
            throw new Error('Socket.IO client não carregado');
        }
    }

    window.gymChatConnect = function () {
        ensureIo();
        if (socket && socket.connected) {
            return Promise.resolve(socket);
        }
        if (connectPromise) {
            return connectPromise;
        }
        connectPromise = new Promise(function (resolve, reject) {
            var s = io({
                path: '/socket.io',
                withCredentials: true,
                transports: ['websocket', 'polling']
            });
            socket = s;

            s.on('connect', function () {
                connectPromise = null;
                resolve(s);
            });

            s.on('connect_error', function (err) {
                connectPromise = null;
                try {
                    s.disconnect();
                } catch (e2) {}
                socket = null;
                reject(err || new Error('Falha ao conectar ao chat'));
            });

            s.on('chat:new', function (data) {
                if (!data || !data.message) return;
                messageListeners.forEach(function (fn) {
                    try {
                        fn(data);
                    } catch (e) {}
                });
            });

            s.on('chat:typing', function (data) {
                typingListeners.forEach(function (fn) {
                    try {
                        fn(data);
                    } catch (e) {}
                });
            });

            s.on('presence:peer', function (data) {
                presenceListeners.forEach(function (fn) {
                    try {
                        fn(data);
                    } catch (e) {}
                });
            });
        });
        return connectPromise;
    };

    window.gymChatOnMessage = function (fn) {
        messageListeners.push(fn);
        return function unsubscribe() {
            var i = messageListeners.indexOf(fn);
            if (i !== -1) messageListeners.splice(i, 1);
        };
    };

    window.gymChatIsOnline = function () {
        return !!(socket && socket.connected);
    };

    window.gymChatSend = function (toUserId, body, cb) {
        if (!socket || !socket.connected) {
            cb(new Error('offline'));
            return;
        }
        socket.emit('chat:send', { toUserId: toUserId, body: body }, function (res) {
            if (res && res.error) {
                var e = new Error(res.error);
                if (res.code) e.code = res.code;
                cb(e);
                return;
            }
            cb && cb(null);
        });
    };

    window.gymChatTyping = function (toUserId, typing) {
        if (!socket || !socket.connected) return;
        socket.emit('chat:typing', { toUserId: toUserId, typing: !!typing });
    };

    window.gymChatOnTyping = function (fn) {
        typingListeners.push(fn);
        return function unsubscribe() {
            var i = typingListeners.indexOf(fn);
            if (i !== -1) typingListeners.splice(i, 1);
        };
    };

    window.gymChatOnPresence = function (fn) {
        presenceListeners.push(fn);
        return function unsubscribe() {
            var i = presenceListeners.indexOf(fn);
            if (i !== -1) presenceListeners.splice(i, 1);
        };
    };
})();
