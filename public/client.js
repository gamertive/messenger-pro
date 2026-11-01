const socket = io();

let currentUser = null;
let currentChat = 'general';
let selectedUser = null;
let currentCallId = null;
let peerConnection = null;
let localStream = null;
let callTimer = null;
let callStartTime = null;
let pendingImage = null;
let chatHistory = { general: [], private: {} };

const authScreen = document.getElementById('authScreen');
const mainScreen = document.getElementById('mainScreen');
const messagesDiv = document.getElementById('messages');
const messageInput = document.getElementById('messageInput');
const sidebar = document.getElementById('sidebar');
const callStatus = document.getElementById('callStatus');
const callConnectionStatus = document.getElementById('callConnectionStatus');

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

document.getElementById('settingsBtn').addEventListener('click', () => {
    document.getElementById('settingsModal').style.display = 'flex';
});

document.getElementById('closeSettingsBtn').addEventListener('click', () => {
    document.getElementById('settingsModal').style.display = 'none';
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
        currentUser = data.username;
        document.getElementById('currentUsername').textContent = currentUser;
        authScreen.classList.remove('active');
        mainScreen.classList.add('active');
        socket.emit('user online', currentUser);
    } else {
        document.getElementById('authError').textContent = data.error;
    }
});

document.getElementById('logoutBtn').addEventListener('click', () => location.reload());

// === Мобильная навигация ===
document.getElementById('menuBtn').addEventListener('click', () => sidebar.classList.add('open'));
document.getElementById('mobileBackBtn').addEventListener('click', () => {
    sidebar.classList.add('open');
    currentChat = 'general';
    selectedUser = null;
    document.getElementById('chatTitle').textContent = 'Общий чат';
    document.getElementById('callButtons').style.display = 'none';
    loadMessages();
});

// === Чаты ===
document.querySelectorAll('.chat-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.chat-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentChat = tab.dataset.chat;
        if (window.innerWidth <= 768) sidebar.classList.remove('open');
        
        if (currentChat === 'general') {
            document.getElementById('chatTitle').textContent = 'Общий чат';
            document.getElementById('callButtons').style.display = 'none';
            selectedUser = null;
        } else {
            document.getElementById('chatTitle').textContent = 'Выберите пользователя';
            document.getElementById('callButtons').style.display = 'none';
            messagesDiv.innerHTML = '';
        }
        loadMessages();
    });
});

socket.on('users update', (users) => {
    const list = document.getElementById('usersList');
    list.innerHTML = '';
    users.forEach(user => {
        if (user.username === currentUser) return;
        const item = document.createElement('div');
        item.className = 'user-item' + (selectedUser === user.username ? ' active' : '');
        item.innerHTML = `<span class="status-dot ${user.status}"></span><span>${user.username}</span>`;
        item.addEventListener('click', () => {
            selectedUser = user.username;
            document.querySelectorAll('.user-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            document.getElementById('chatTitle').textContent = user.username;
            document.getElementById('callButtons').style.display = user.status === 'online' ? 'flex' : 'none';
            if (window.innerWidth <= 768) sidebar.classList.remove('open');
            loadMessages();
        });
        list.appendChild(item);
    });
});

function loadMessages() {
    messagesDiv.innerHTML = '';
    if (currentChat === 'general') {
        chatHistory.general.forEach(msg => addMessage(msg, msg.username === currentUser, false));
    } else if (selectedUser) {
        const key = [currentUser, selectedUser].sort().join(':');
        if (!chatHistory.private[key]) chatHistory.private[key] = [];
        chatHistory.private[key].forEach(msg => addMessage(msg, msg.from === currentUser, false));
        socket.emit('get private history', { user1: currentUser, user2: selectedUser });
    }
}

// === Сообщения ===
function sendMessage() {
    const text = messageInput.value.trim();
    if (!text && !pendingImage) return;
    const msgData = { text, image: pendingImage, username: currentUser };
    
    if (currentChat === 'general') {
        socket.emit('chat message', msgData);
    } else if (selectedUser) {
        socket.emit('private message', { from: currentUser, to: selectedUser, ...msgData });
    }
    
    messageInput.value = '';
    pendingImage = null;
}

document.getElementById('sendBtn').addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });

socket.on('chat message', (msg) => {
    if (currentChat === 'general') {
        chatHistory.general.push(msg);
        if (chatHistory.general.length > 200) chatHistory.general.shift();
        addMessage(msg, msg.username === currentUser, true);
    }
});

socket.on('private message', (msg) => {
    const key = [msg.from, msg.to].sort().join(':');
    if (!chatHistory.private[key]) chatHistory.private[key] = [];
    chatHistory.private[key].push(msg);
    if (chatHistory.private[key].length > 100) chatHistory.private[key].shift();
    
    if (currentChat === 'private' && (msg.from === selectedUser || msg.to === selectedUser)) {
        addMessage(msg, msg.from === currentUser, true);
    }
});

socket.on('message history', (history) => {
    chatHistory.general = history;
    if (currentChat === 'general') loadMessages();
});

socket.on('private history', (history) => {
    if (selectedUser) {
        const key = [currentUser, selectedUser].sort().join(':');
        chatHistory.private[key] = history;
        loadMessages();
    }
});

function addMessage(msg, isOwn, animate = true) {
    const div = document.createElement('div');
    div.className = `message ${isOwn ? 'own' : 'other'}`;
    if (!animate) div.style.animation = 'none';
    
    let content = '';
    if (msg.text) content += `<div class="message-text">${escapeHtml(msg.text)}</div>`;
    if (msg.image) content += `<div class="message-text"><img src="${msg.image}" onclick="saveImage('${msg.image}')"></div>`;
    
    const time = msg.timestamp || new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const header = isOwn ? '' : `<div class="message-header">${escapeHtml(msg.username || msg.from)}</div>`;
    
    div.innerHTML = `${header}${content}<div class="message-time">${time}</div>`;
    messagesDiv.appendChild(div);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function saveImage(imageData) {
    const link = document.createElement('a');
    link.href = imageData;
    link.download = 'image_' + Date.now() + '.png';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// === Эмодзи и Фото ===
const emojis = ['😀','😂','😍','😎','👍','❤️','🔥','🎉','🙏','😊','🤔','😴','🤗','😱','🥳'];
const picker = document.getElementById('emojiPicker');
emojis.forEach(e => {
    const span = document.createElement('span');
    span.textContent = e;
    span.onclick = () => { messageInput.value += e; picker.style.display = 'none'; };
    picker.appendChild(span);
});

document.getElementById('emojiBtn').onclick = () => {
    picker.style.display = picker.style.display === 'grid' ? 'none' : 'grid';
};

document.getElementById('imageBtn').onclick = () => document.getElementById('imageInput').click();
document.getElementById('imageInput').onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => { 
        pendingImage = ev.target.result;
        sendMessage();
    };
    reader.readAsDataURL(file);
};

// === ЗВОНКИ ===
const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

document.getElementById('audioCallBtn').onclick = () => startCall('audio');
document.getElementById('videoCallBtn').onclick = () => startCall('video');

async function startCall(callType) {
    if (!selectedUser) return;
    try {
        const constraints = callType === 'video' ? { audio: true, video: true } : { audio: true, video: false };
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        
        currentCallId = Date.now() + '_' + currentUser + '_' + selectedUser;
        peerConnection = new RTCPeerConnection(rtcConfig);
        
        peerConnection.onconnectionstatechange = () => {
            const state = peerConnection.connectionState;
            callConnectionStatus.textContent = state === 'connected' ? 'Подключено' : 
                                               state === 'connecting' ? 'Подключение...' : 
                                               state === 'failed' ? 'Ошибка соединения' : 'Завершено';
            callConnectionStatus.className = 'connection-status ' + state;
        };

        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
        
        peerConnection.ontrack = (event) => {
            const remoteVideo = document.getElementById('remoteVideo');
            remoteVideo.srcObject = event.streams[0];
            remoteVideo.muted = false;
            remoteVideo.play().catch(e => console.log('Autoplay prevented:', e));
        };
        
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) socket.emit('ice candidate', { to: selectedUser, candidate: event.candidate });
        };
        
        document.getElementById('localVideo').srcObject = localStream;
        document.getElementById('localVideo').style.display = callType === 'audio' ? 'none' : 'block';
        
        socket.emit('call user', { callId: currentCallId, from: currentUser, to: selectedUser, callType });
        
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.emit('call offer', { callId: currentCallId, to: selectedUser, offer });
        
        showCallWindow(selectedUser);
    } catch (err) {
        alert('Ошибка доступа к микрофону/камере: ' + err.message);
    }
}

socket.on('incoming call', (data) => {
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
            callConnectionStatus.textContent = state === 'connected' ? 'Подключено' : state === 'connecting' ? 'Подключение...' : 'Ошибка';
            callConnectionStatus.className = 'connection-status ' + state;
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
    if (selectedUser) socket.emit('call end', { callId: currentCallId, to: selectedUser });
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
        track.enabled = !track.enabled;
        this.classList.toggle('active');
        this.querySelector('span').textContent = track.enabled ? 'mic' : 'mic_off';
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
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}