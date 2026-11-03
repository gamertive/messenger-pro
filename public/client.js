const socket = io();

let currentUser = null;
let currentChatUser = null;
let currentCallId = null;
let peerConnection = null;
let localStream = null;
let callTimer = null;
let callStartTime = null;
let pendingImage = null;

let usersData = {};
let chatHistory = {};
let myAvatar = null;

// === Генерация аватарки ===
function generateAvatar(name) {
    const colors = ['#006C4C', '#BA1A1A', '#0061A4', '#7D5260', '#6B4FA2', '#9C4146', '#B35900', '#006874'];
    const hash = name.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
    const color = colors[hash % colors.length];
    const letter = name.charAt(0).toUpperCase();
    return `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100'><rect width='100' height='100' fill='${encodeURIComponent(color)}'/><text x='50' y='50' font-size='50' text-anchor='middle' dominant-baseline='central' fill='white' font-family='Arial,sans-serif'>${letter}</text></svg>`;
}

function getAvatar(username) {
    if (usersData[username]?.avatar) return usersData[username].avatar;
    return generateAvatar(username);
}

function getMyAvatar() {
    return myAvatar || generateAvatar(currentUser || 'U');
}

// === Тема ===
const themeToggle = document.getElementById('themeToggle');
const savedTheme = localStorage.getItem('theme') || 'light';
document.documentElement.setAttribute('data-theme', savedTheme);
themeToggle.checked = savedTheme === 'dark';

themeToggle.addEventListener('change', () => {
    const theme = themeToggle.checked ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
});

// === Авторизация ===
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.form').forEach(f => f.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(tab.dataset.tab + 'Form').classList.add('active');
        document.getElementById('authError').textContent = '';
    });
});

document.getElementById('registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('regUsername').value.trim();
    const password = document.getElementById('regPassword').value.trim();
    const res = await fetch('/api/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    const errEl = document.getElementById('authError');
    if (data.success) {
        errEl.style.color = '#00C853';
        errEl.textContent = 'Успешно! Теперь войдите.';
        setTimeout(() => document.querySelector('.tab[data-tab="login"]').click(), 1500);
    } else {
        errEl.style.color = '#BA1A1A';
        errEl.textContent = data.error;
    }
});

document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value.trim();
    const res = await fetch('/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (data.success) {
        currentUser = username;
        myAvatar = localStorage.getItem('myAvatar_' + username) || null;
        socket.emit('user online', { username, avatar: myAvatar });
        showChatsScreen();
    } else {
        document.getElementById('authError').textContent = data.error;
    }
});

function showChatsScreen() {
    document.getElementById('authScreen').classList.remove('active');
    document.getElementById('chatsScreen').classList.add('active');
    document.getElementById('chatScreen').classList.remove('active');
    document.getElementById('myAvatarImg').src = getMyAvatar();
}

// === Настройки ===
document.getElementById('settingsBtn').addEventListener('click', () => {
    document.getElementById('settingsModal').style.display = 'flex';
    document.getElementById('settingsAvatar').src = getMyAvatar();
    document.getElementById('settingsUsername').textContent = currentUser;
});

document.getElementById('closeSettingsBtn').addEventListener('click', () => {
    document.getElementById('settingsModal').style.display = 'none';
});

document.getElementById('avatarInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        myAvatar = ev.target.result;
        localStorage.setItem('myAvatar', myAvatar);
        localStorage.setItem('myAvatar_' + currentUser, myAvatar);
        document.getElementById('settingsAvatar').src = myAvatar;
        document.getElementById('myAvatarImg').src = myAvatar;
        socket.emit('update avatar', myAvatar);
        renderChatsList();
    };
    reader.readAsDataURL(file);
});

document.getElementById('logoutBtn').addEventListener('click', () => {
    if (currentUser) localStorage.removeItem('myAvatar_' + currentUser);
    location.reload();
});

// === Поиск ===
document.getElementById('searchInput').addEventListener('input', (e) => {
    renderChatsList(e.target.value.toLowerCase());
});

// === Список чатов ===
socket.on('users update', (users) => {
    users.forEach(u => {
        usersData[u.username] = { status: u.status, avatar: u.avatar };
    });
    if (currentChatUser && usersData[currentChatUser]) {
        updatePartnerStatus();
    }
    renderChatsList();
});

function renderChatsList(filter = '') {
    const list = document.getElementById('chatsList');
    list.innerHTML = '';
    
    const otherUsers = Object.keys(usersData).filter(u => u !== currentUser);
    const filtered = otherUsers.filter(u => u.toLowerCase().includes(filter));
    
    if (filtered.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <span class="material-symbols-rounded">forum</span>
                <p>${filter ? 'Ничего не найдено' : 'Пока нет пользователей'}</p>
            </div>
        `;
        return;
    }
    
    filtered.sort((a, b) => {
        const aHasChat = chatHistory[a]?.length > 0;
        const bHasChat = chatHistory[b]?.length > 0;
        if (aHasChat && !bHasChat) return -1;
        if (!aHasChat && bHasChat) return 1;
        const aOnline = usersData[a].status === 'online' ? 0 : 1;
        const bOnline = usersData[b].status === 'online' ? 0 : 1;
        return aOnline - bOnline;
    });
    
    filtered.forEach(username => {
        const user = usersData[username];
        const history = chatHistory[username] || [];
        const lastMsg = history[history.length - 1];
        
        const item = document.createElement('div');
        item.className = 'chat-item';
        
        let preview = 'Нет сообщений';
        let time = '';
        if (lastMsg) {
            preview = lastMsg.from === currentUser ? 'Вы: ' : '';
            preview += lastMsg.image ? '📷 Фото' : lastMsg.text;
            time = lastMsg.timestamp;
        }
        
        item.innerHTML = `
            <div class="avatar-wrapper">
                <img class="avatar-medium" src="${getAvatar(username)}" alt="">
                <span class="status-indicator ${user.status}"></span>
            </div>
            <div class="chat-item-content">
                <div class="chat-item-top">
                    <span class="chat-item-name">${escapeHtml(username)}</span>
                    <span class="chat-item-time">${time}</span>
                </div>
                <div class="chat-item-preview">${escapeHtml(preview)}</div>
            </div>
        `;
        
        item.addEventListener('click', () => openChat(username));
        list.appendChild(item);
    });
}

// === Открытие чата ===
function openChat(username) {
    currentChatUser = username;
    document.getElementById('chatScreen').classList.add('active');
    document.getElementById('chatTitle').textContent = username;
    document.getElementById('partnerAvatar').src = getAvatar(username);
    updatePartnerStatus();
    
    const messagesDiv = document.getElementById('messages');
    messagesDiv.innerHTML = '';
    
    const history = chatHistory[username] || [];
    history.forEach(msg => addMessage(msg, false));
    
    socket.emit('get private history', { user1: currentUser, user2: username });
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function updatePartnerStatus() {
    if (!currentChatUser || !usersData[currentChatUser]) return;
    const status = usersData[currentChatUser].status;
    const statusEl = document.getElementById('partnerStatus');
    statusEl.textContent = status === 'online' ? 'в сети' : 'не в сети';
    statusEl.className = 'partner-status ' + (status === 'online' ? '' : 'offline');
}

document.getElementById('backBtn').addEventListener('click', () => {
    document.getElementById('chatScreen').classList.remove('active');
    document.getElementById('emojiPicker').classList.remove('show');
    currentChatUser = null;
    renderChatsList();
});

// === Сообщения ===
function sendMessage() {
    const text = document.getElementById('messageInput').value.trim();
    if (!text && !pendingImage) return;
    if (!currentChatUser) return;
    
    socket.emit('private message', {
        from: currentUser,
        to: currentChatUser,
        text: text,
        image: pendingImage
    });
    
    document.getElementById('messageInput').value = '';
    pendingImage = null;
}

document.getElementById('sendBtn').addEventListener('click', sendMessage);
document.getElementById('messageInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

socket.on('private message', (msg) => {
    const otherUser = msg.from === currentUser ? msg.to : msg.from;
    if (!chatHistory[otherUser]) chatHistory[otherUser] = [];
    chatHistory[otherUser].push(msg);
    
    if (currentChatUser === otherUser) {
        addMessage(msg, true);
    }
    renderChatsList();
});

socket.on('private history', (history) => {
    if (!currentChatUser) return;
    chatHistory[currentChatUser] = history;
    const messagesDiv = document.getElementById('messages');
    messagesDiv.innerHTML = '';
    history.forEach(msg => addMessage(msg, false));
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
});

function addMessage(msg, animate = true) {
    const div = document.createElement('div');
    const isOwn = msg.from === currentUser;
    div.className = `message ${isOwn ? 'own' : 'other'}`;
    if (!animate) div.style.animation = 'none';
    
    let content = '';
    if (msg.text) content += `<div class="message-text">${escapeHtml(msg.text)}</div>`;
    if (msg.image) {
        content += `<div class="message-text"><img src="${msg.image}" onclick="saveImage(this.src)"></div>`;
    }
    
    div.innerHTML = `${content}<div class="message-time">${msg.timestamp}</div>`;
    document.getElementById('messages').appendChild(div);
    document.getElementById('messages').scrollTop = document.getElementById('messages').scrollHeight;
}

function saveImage(src) {
    const link = document.createElement('a');
    link.href = src;
    link.download = 'image_' + Date.now() + '.png';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// === Эмодзи (СКРЫТО ПО УМОЛЧАНИЮ) ===
const emojis = ['😀','😂','😍','😎','👍','❤️','🔥','🎉','🙏','😊','🤔','😴','🤗','😱','🥳','😢','😡','🤩','😇','🙃'];
const picker = document.getElementById('emojiPicker');
emojis.forEach(e => {
    const span = document.createElement('span');
    span.textContent = e;
    span.onclick = () => {
        document.getElementById('messageInput').value += e;
        picker.classList.remove('show');
    };
    picker.appendChild(span);
});

document.getElementById('emojiBtn').onclick = () => {
    picker.classList.toggle('show');
};

// === ОТПРАВКА ФОТО (ИСПРАВЛЕНО) ===
document.getElementById('imageBtn').onclick = () => {
    document.getElementById('imageInput').click();
};

document.getElementById('imageInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    // Проверка размера (макс 5 МБ)
    if (file.size > 5 * 1024 * 1024) {
        alert('Файл слишком большой. Максимум 5 МБ.');
        e.target.value = '';
        return;
    }
    
    const reader = new FileReader();
    reader.onload = (ev) => { 
        pendingImage = ev.target.result;
        // Отправляем сразу после загрузки
        sendMessage();
    };
    reader.onerror = () => {
        alert('Ошибка чтения файла');
    };
    reader.readAsDataURL(file);
    
    // ВАЖНО: сбрасываем input, чтобы можно было выбрать тот же файл повторно
    e.target.value = '';
});

// === Звонки ===
const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

document.getElementById('audioCallBtn').onclick = () => startCall('audio');
document.getElementById('videoCallBtn').onclick = () => startCall('video');

async function startCall(callType) {
    if (!currentChatUser) return;
    try {
        const constraints = callType === 'video' ? { audio: true, video: true } : { audio: true, video: false };
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        
        currentCallId = Date.now() + '_' + currentUser + '_' + currentChatUser;
        peerConnection = new RTCPeerConnection(rtcConfig);
        
        peerConnection.onconnectionstatechange = () => {
            const state = peerConnection.connectionState;
            const statusEl = document.getElementById('callConnectionStatus');
            statusEl.textContent = state === 'connected' ? 'Подключено' : 
                                   state === 'connecting' ? 'Подключение...' : 
                                   state === 'failed' ? 'Ошибка соединения' : 'Завершено';
            statusEl.className = 'connection-status ' + state;
        };

        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
        
        peerConnection.ontrack = (event) => {
            const remoteVideo = document.getElementById('remoteVideo');
            remoteVideo.srcObject = event.streams[0];
            remoteVideo.muted = false;
            remoteVideo.play().catch(e => console.log('Autoplay prevented:', e));
        };
        
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) socket.emit('ice candidate', { to: currentChatUser, candidate: event.candidate });
        };
        
        document.getElementById('localVideo').srcObject = localStream;
        document.getElementById('localVideo').style.display = callType === 'audio' ? 'none' : 'block';
        document.getElementById('callPartnerAvatar').src = getAvatar(currentChatUser);
        
        socket.emit('call user', { callId: currentCallId, from: currentUser, to: currentChatUser, callType });
        
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.emit('call offer', { callId: currentCallId, to: currentChatUser, offer });
        
        showCallWindow(currentChatUser);
    } catch (err) {
        alert('Ошибка доступа к микрофону/камере: ' + err.message);
    }
}

socket.on('incoming call', (data) => {
    document.getElementById('callerAvatar').src = getAvatar(data.from);
    document.getElementById('callerName').textContent = data.from;
    document.getElementById('callType').textContent = data.callType === 'video' ? 'Видеозвонок' : 'Аудиозвонок';
    document.getElementById('incomingCallModal').style.display = 'flex';
    
    document.getElementById('acceptCallBtn').onclick = () => acceptCall(data);
    document.getElementById('rejectCallBtn').onclick = () => {
        socket.emit('call end', { callId: data.callId, to: data.from });
        document.getElementById('incomingCallModal').style.display = 'none';
    };
});

async function acceptCall(data) {
    document.getElementById('incomingCallModal').style.display = 'none';
    currentCallId = data.callId;
    try {
        const constraints = data.callType === 'video' ? { audio: true, video: true } : { audio: true, video: false };
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        
        peerConnection = new RTCPeerConnection(rtcConfig);
        
        peerConnection.onconnectionstatechange = () => {
            const state = peerConnection.connectionState;
            const statusEl = document.getElementById('callConnectionStatus');
            statusEl.textContent = state === 'connected' ? 'Подключено' : state === 'connecting' ? 'Подключение...' : 'Ошибка';
            statusEl.className = 'connection-status ' + state;
        };

        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
        peerConnection.ontrack = (event) => {
            document.getElementById('remoteVideo').srcObject = event.streams[0];
            document.getElementById('remoteVideo').muted = false;
        };
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) socket.emit('ice candidate', { to: data.from, candidate: event.candidate });
        };
        
        document.getElementById('localVideo').srcObject = localStream;
        document.getElementById('localVideo').style.display = data.callType === 'audio' ? 'none' : 'block';
        document.getElementById('callPartnerAvatar').src = getAvatar(data.from);
        
        socket.once('call offer', async (offerData) => {
            if (offerData.callId === currentCallId) {
                await peerConnection.setRemoteDescription(offerData.offer);
                const answer = await peerConnection.createAnswer();
                await peerConnection.setLocalDescription(answer);
                socket.emit('call answer', { callId: currentCallId, answer });
            }
        });
        
        showCallWindow(data.from);
    } catch (err) {
        alert('Ошибка: ' + err.message);
    }
}

socket.on('call answered', async (data) => {
    if (data.callId === currentCallId && peerConnection) {
        await peerConnection.setRemoteDescription(data.answer);
        startCallTimer();
    }
});

socket.on('ice candidate', async (data) => {
    if (peerConnection && data.candidate) await peerConnection.addIceCandidate(data.candidate);
});

socket.on('call ended', () => endCall());

function showCallWindow(partner) {
    document.getElementById('callPartner').textContent = partner;
    document.getElementById('callWindow').style.display = 'flex';
    startCallTimer();
}

function startCallTimer() {
    callStartTime = Date.now();
    callTimer = setInterval(() => {
        const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
        document.getElementById('callTimer').textContent = 
            String(Math.floor(elapsed / 60)).padStart(2, '0') + ':' + String(elapsed % 60).padStart(2, '0');
    }, 1000);
}

document.getElementById('endCallBtn').onclick = () => {
    if (currentChatUser) socket.emit('call end', { callId: currentCallId, to: currentChatUser });
    endCall();
};

function endCall() {
    if (peerConnection) { peerConnection.close(); peerConnection = null; }
    if (localStream) { localStream.getTracks().forEach(track => track.stop()); localStream = null; }
    if (callTimer) { clearInterval(callTimer); callTimer = null; }
    document.getElementById('callWindow').style.display = 'none';
    document.getElementById('localVideo').style.display = 'block';
    currentCallId = null;
}

document.getElementById('muteBtn').onclick = function() {
    if (localStream) {
        const track = localStream.getAudioTracks()[0];
        if (track) {
            track.enabled = !track.enabled;
            this.classList.toggle('active');
            this.querySelector('span').textContent = track.enabled ? 'mic' : 'mic_off';
        }
    }
};

document.getElementById('cameraBtn').onclick = function() {
    if (localStream) {
        const track = localStream.getVideoTracks()[0];
        if (track) {
            track.enabled = !track.enabled;
            this.classList.toggle('active');
            this.querySelector('span').textContent = track.enabled ? 'videocam' : 'videocam_off';
        }
    }
};

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}