const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '10mb' }));

const ENCRYPTION_KEY = crypto.randomBytes(32);
const IV_LENGTH = 16;

function encrypt(text) {
    let iv = crypto.randomBytes(IV_LENGTH);
    let cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(text) {
    let textParts = text.split(':');
    let iv = Buffer.from(textParts.shift(), 'hex');
    let encryptedText = Buffer.from(textParts.join(':'), 'hex');
    let decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
}

const users = new Map();
const messages = [];
const privateMessages = new Map();
const callMap = new Map(); // callId -> {from, to}

app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Заполните все поля' });
    if (users.has(username)) return res.status(400).json({ error: 'Пользователь существует' });
    const hash = await bcrypt.hash(password, 10);
    users.set(username, { password: hash, socketId: null, status: 'offline' });
    res.json({ success: true });
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const user = users.get(username);
    if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(401).json({ error: 'Неверные данные' });
    }
    res.json({ success: true, username });
});

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
        socket.emit('message history', messages.map(m => ({...m, text: decrypt(m.text)})));
    });

    socket.on('chat message', (msg) => {
        const messageData = {
            text: encrypt(msg.text),
            image: msg.image,
            username: msg.username,
            timestamp: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
        };
        messages.push(messageData);
        if (messages.length > 200) messages.shift();
        const decryptedMsg = { ...messageData, text: decrypt(messageData.text) };
        io.emit('chat message', decryptedMsg);
    });

    socket.on('private message', (data) => {
        const key = [data.from, data.to].sort().join(':');
        if (!privateMessages.has(key)) privateMessages.set(key, []);
        const msg = {
            from: data.from,
            to: data.to,
            text: encrypt(data.text),
            image: data.image,
            timestamp: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
        };
        privateMessages.get(key).push(msg);
        const decryptedMsg = { ...msg, text: decrypt(msg.text) };
        io.to(data.to).emit('private message', decryptedMsg);
        socket.emit('private message', decryptedMsg);
    });

    socket.on('get private history', (data) => {
        const key = [data.user1, data.user2].sort().join(':');
        const history = (privateMessages.get(key) || []).map(m => ({...m, text: decrypt(m.text)}));
        socket.emit('private history', history);
    });

    // === ИСПРАВЛЕННЫЕ ЗВОНКИ ===
    socket.on('call user', (data) => {
        const target = users.get(data.to);
        if (!target || !target.socketId) {
            return socket.emit('call failed', { reason: 'Не в сети' });
        }
        callMap.set(data.callId, { from: data.from, to: data.to });
        io.to(target.socketId).emit('incoming call', {
            callId: data.callId,
            from: data.from,
            callType: data.callType
        });
    });

    socket.on('call offer', (data) => {
        const call = callMap.get(data.callId);
        if (call) {
            const target = users.get(call.to);
            if (target && target.socketId) {
                io.to(target.socketId).emit('call offer', {
                    callId: data.callId,
                    offer: data.offer
                });
            }
        }
    });

    socket.on('call answer', (data) => {
        const call = callMap.get(data.callId);
        if (call) {
            const caller = users.get(call.from);
            if (caller && caller.socketId) {
                io.to(caller.socketId).emit('call answered', {
                    callId: data.callId,
                    answer: data.answer
                });
            }
        }
    });

    socket.on('ice candidate', (data) => {
        const target = users.get(data.to);
        if (target && target.socketId) {
            io.to(target.socketId).emit('ice candidate', { candidate: data.candidate });
        }
    });

    socket.on('call end', (data) => {
        const target = users.get(data.to);
        if (target && target.socketId) {
            io.to(target.socketId).emit('call ended');
        }
        callMap.delete(data.callId);
    });

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

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log('Сервер запущен на порту ' + PORT);
});