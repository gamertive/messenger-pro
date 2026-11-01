const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const bcrypt = require('bcryptjs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '10mb' }));

const users = new Map();
const messages = [];
const privateMessages = new Map();
const callRequests = new Map();

// === API ===
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Заполните все поля' });
    if (users.has(username)) return res.status(400).json({ error: 'Пользователь уже существует' });
    const hash = await bcrypt.hash(password, 10);
    users.set(username, { password: hash, socketId: null, status: 'offline' });
    res.json({ success: true });
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const user = users.get(username);
    if (!user) return res.status(401).json({ error: 'Неверные данные' });
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Неверные данные' });
    res.json({ success: true, username });
});

app.get('/api/users', (req, res) => {
    const list = [];
    users.forEach((data, username) => list.push({ username, status: data.status }));
    res.json(list);
});

// === WebSocket ===
io.on('connection', (socket) => {
    let currentUser = null;

    socket.on('user online', (username) => {
        currentUser = username;
        const user = users.get(username);
        if (user) {
            user.socketId = socket.id;
            user.status = 'online';
        }
        socket.join(username);
        io.emit('users update', getUserList());
        socket.emit('message history', messages);
    });

    socket.on('chat message', (msg) => {
        const messageData = {
            text: msg.text,
            image: msg.image,
            username: msg.username,
            timestamp: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
        };
        messages.push(messageData);
        if (messages.length > 200) messages.shift();
        io.emit('chat message', messageData);
    });

    socket.on('private message', (data) => {
        const key = getPrivateKey(data.from, data.to);
        if (!privateMessages.has(key)) privateMessages.set(key, []);
        const msg = {
            from: data.from,
            to: data.to,
            text: data.text,
            image: data.image,
            timestamp: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
        };
        privateMessages.get(key).push(msg);
        if (privateMessages.get(key).length > 100) privateMessages.get(key).shift();
        io.to(data.to).emit('private message', msg);
        socket.emit('private message', msg);
    });

    socket.on('get private history', (data) => {
        const key = getPrivateKey(data.user1, data.user2);
        socket.emit('private history', privateMessages.get(key) || []);
    });

    // === Звонки ===
    socket.on('call user', (data) => {
        const target = users.get(data.to);
        if (!target || !target.socketId) {
            socket.emit('call failed', { reason: 'Пользователь не в сети' });
            return;
        }
        const callId = Date.now() + '_' + data.from + '_' + data.to;
        callRequests.set(callId, { from: data.from, to: data.to, type: data.callType });
        io.to(target.socketId).emit('incoming call', {
            callId: callId,
            from: data.from,
            callType: data.callType
        });
    });

    socket.on('call offer', (data) => {
        const target = users.get(data.to);
        if (target && target.socketId) {
            io.to(target.socketId).emit('call offer', { callId: data.callId, offer: data.offer });
        }
    });

    socket.on('call answer', (data) => {
        const call = callRequests.get(data.callId);
        if (call) {
            const caller = users.get(call.from);
            if (caller && caller.socketId) {
                io.to(caller.socketId).emit('call answered', { callId: data.callId, answer: data.answer });
            }
        }
    });

    socket.on('ice candidate', (data) => {
        const target = users.get(data.to);
        if (target && target.socketId) {
            io.to(target.socketId).emit('ice candidate', { candidate: data.candidate });
        }
    });

    socket.on('call reject', (data) => {
        const caller = users.get(data.from);
        if (caller && caller.socketId) {
            io.to(caller.socketId).emit('call rejected', { callId: data.callId });
        }
        callRequests.delete(data.callId);
    });

    socket.on('call end', (data) => {
        const target = users.get(data.to);
        if (target && target.socketId) {
            io.to(target.socketId).emit('call ended', { callId: data.callId });
        }
        callRequests.delete(data.callId);
    });

    // === Отключение ===
    socket.on('disconnect', () => {
        if (currentUser) {
            const user = users.get(currentUser);
            if (user) {
                user.socketId = null;
                user.status = 'offline';
            }
            io.emit('users update', getUserList());
        }
    });
});

function getUserList() {
    const list = [];
    users.forEach((data, username) => list.push({ username, status: data.status }));
    return list;
}

function getPrivateKey(u1, u2) {
    return [u1, u2].sort().join(':');
}

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log('Мессенджер запущен и доступен в сети на порту ' + PORT);
});