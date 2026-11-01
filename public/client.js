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

// === Элементы DOM ===
const authScreen = document.getElementById('authScreen');
const mainScreen = document.getElementById('mainScreen');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const authError = document.getElementById('authError');
const messagesDiv = document.getElementById('messages');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const emojiBtn = document.getElementById('emojiBtn');
const emojiPicker = document.getElementById('emojiPicker');
const imageBtn = document.getElementById('imageBtn');
const imageInput = document.getElementById('imageInput');
const usersList = document.getElementById('usersList');
const chatTitle = document.getElementById('chatTitle');
const callButtons = document.getElementById('callButtons');

// === Переключение табов ===
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.form').forEach(f => f.classList.remove('active'));
        tab.classList.add('active');
        const targetForm = document.getElementById(tab.dataset.tab + 'Form');
        if (targetForm) targetForm.classList.add('active');
        authError.textContent = '';
        authError.style.color = '#e74c3c';
    });
});

// === Регистрация ===
registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('regUsername').value.trim();
    const password = document.getElementById('regPassword').value.trim();
    
    if (!username || !password) {
        authError.style.color = '#e74c3c';
        authError.textContent = 'Заполните все поля';
        return;
    }
    
    try {
        const res = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        
        const data = await res.json();
        
        if (data.success) {
            authError.style.color = '#2ecc71';
            authError.textContent = '✓ Регистрация успешна! Теперь войдите.';
            setTimeout(() => {
                document.querySelector('.tab[data-tab="login"]').click();
            }, 1500);
        } else {
            authError.style.color = '#e74c3c';
            authError.textContent = data.error || 'Ошибка регистрации';
        }
    } catch (err) {
        authError.style.color = '#e74c3c';
        authError.textContent = 'Ошибка соединения с сервером';
    }
});

// === Вход ===
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value.trim();
    
    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        
        const data = await res.json();
        
        if (data.success) {
            currentUser = data.username;
            document.getElementById('currentUsername').textContent = currentUser;
            authScreen.classList.remove('active');
            mainScreen.classList.add('active');
            socket.emit('user online', currentUser);
            requestNotificationPermission();
        } else {
            authError.textContent = data.error;
        }
    } catch (err) {
        authError.textContent = 'Ошибка соединения с сервером';
    }
});

document.getElementById('logoutBtn').addEventListener('click', () => {
    location.reload();
});

// === Переключение чатов ===
document.querySelectorAll('.chat-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.chat-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentChat = tab.dataset.chat;
        messagesDiv.innerHTML = '';
        
        if (currentChat === 'general') {
            chatTitle.textContent = 'Общий чат';
            callButtons.style.display = 'none';
            selectedUser = null;
        } else {
            chatTitle.textContent = 'Выберите пользователя';
            callButtons.style.display = 'none';
        }
    });
});

// === Отправка сообщений ===
function sendMessage() {
    const text = messageInput.value.trim();
    if (!text && !pendingImage) return;
    
    const msgData = { text: text, image: pendingImage, username: currentUser };
    
    if (currentChat === 'general') {
        socket.emit('chat message', msgData);
    } else if (selectedUser) {
        socket.emit('private message', { from: currentUser, to: selectedUser, ...msgData });
    }
    
    messageInput.value = '';
    pendingImage = null;
}

sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

// === Получение сообщений ===
socket.on('chat message', (msg) => {
    if (currentChat === 'general') addMessage(msg, msg.username === currentUser);
    if (msg.username !== currentUser && document.hidden) {
        showNotification(msg.username + ': ' + (msg.text || '📷 Фото'));
    }
});

socket.on('private message', (msg) => {
    const otherUser = msg.from === currentUser ? msg.to : msg.from;
    if (currentChat === 'private' && selectedUser === otherUser) {
        addMessage(msg, msg.from === currentUser);
    }
    if (msg.from !== currentUser && document.hidden) {
        showNotification(msg.from + ': ' + (msg.text || '📷 Фото'));
    }
});

socket.on('message history', (history) => {
    if (currentChat === 'general') {
        history.forEach(msg => addMessage(msg, msg.username === currentUser));
    }
});

function addMessage(msg, isOwn) {
    const messageEl = document.createElement('div');
    messageEl.className = 'message' + (isOwn ? ' own-message' : '');
    
    let content = '';
    if (msg.text) content += '<div class="message-text">' + escapeHtml(msg.text) + '</div>';
    if (msg.image) content += '<div class="message-text"><img src="' + msg.image + '" alt="image"></div>';
    
    messageEl.innerHTML = 
        '<div class="message-header">' +
            '<span class="username">' + escapeHtml(msg.username || msg.from) + '</span>' +
            '<span class="time">' + msg.timestamp + '</span>' +
        '</div>' +
        content;
    
    messagesDiv.appendChild(messageEl);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// === Список пользователей ===
socket.on('users update', (users) => {
    usersList.innerHTML = '';
    users.forEach(user => {
        if (user.username === currentUser) return;
        
        const item = document.createElement('div');
        item.className = 'user-item' + (selectedUser === user.username ? ' active' : '');
        item.innerHTML = 
            '<div>' +
                '<span class="status-dot ' + user.status + '"></span>' +
                '<span>' + escapeHtml(user.username) + '</span>' +
            '</div>';
        
        item.addEventListener('click', () => {
            selectedUser = user.username;
            document.querySelectorAll('.user-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            chatTitle.textContent = 'Чат с ' + user.username;
            messagesDiv.innerHTML = '';
            socket.emit('get private history', { user1: currentUser, user2: user.username });
            
            if (user.status === 'online') {
                callButtons.style.display = 'flex';
            } else {
                callButtons.style.display = 'none';
            }
        });
        
        usersList.appendChild(item);
    });
});

socket.on('private history', (history) => {
    history.forEach(msg => addMessage(msg, msg.from === currentUser));
});

// === Эмодзи ===
const emojis = ['😀','😂','😍','😎','😢','😡','👍','👎','❤️','🔥','🎉','🙏','😊','🤔','😴','🤗','😱','🥳','😇','🤩'];
emojis.forEach(emoji => {
    const span = document.createElement('span');
    span.textContent = emoji;
    span.addEventListener('click', () => {
        messageInput.value += emoji;
        emojiPicker.style.display = 'none';
    });
    emojiPicker.appendChild(span);
});

emojiBtn.addEventListener('click', () => {
    emojiPicker.style.display = emojiPicker.style.display === 'none' ? 'grid' : 'none';
});

// === Изображения ===
imageBtn.addEventListener('click', () => imageInput.click());

imageInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
        pendingImage = event.target.result;
        sendMessage();
    };
    reader.readAsDataURL(file);
    imageInput.value = '';
});

// === Звонки ===
const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

document.getElementById('audioCallBtn').addEventListener('click', () => startCall('audio'));
document.getElementById('videoCallBtn').addEventListener('click', () => startCall('video'));

async function startCall(callType) {
    if (!selectedUser) return;
    
    try {
        const constraints = callType === 'video' 
            ? { audio: true, video: true } 
            : { audio: true, video: false };
        
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        
        const callId = Date.now() + '_' + currentUser + '_' + selectedUser;
        currentCallId = callId;
        
        peerConnection = new RTCPeerConnection(rtcConfig);
        
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
        
        peerConnection.ontrack = (event) => {
            document.getElementById('remoteVideo').srcObject = event.streams[0];
        };
        
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('ice candidate', { to: selectedUser, candidate: event.candidate });
            }
        };
        
        document.getElementById('localVideo').srcObject = localStream;
        if (callType === 'audio') {
            document.getElementById('localVideo').style.display = 'none';
        }
        
        socket.emit('call user', { from: currentUser, to: selectedUser, callType });
        
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        
        socket.emit('call offer', { callId, to: selectedUser, offer });
        
        showCallWindow(selectedUser, callType);
    } catch (err) {
        alert('Не удалось получить доступ к микрофону/камере: ' + err.message);
    }
}

socket.on('incoming call', (data) => {
    document.getElementById('callerName').textContent = data.from;
    document.getElementById('callType').textContent = data.callType === 'video' ? '📹 Видеозвонок' : '📞 Голосовой вызов';
    document.getElementById('incomingCallModal').style.display = 'flex';
    
    document.getElementById('acceptCallBtn').onclick = () => acceptCall(data);
    document.getElementById('rejectCallBtn').onclick = () => {
        socket.emit('call reject', { callId: data.callId, from: data.from });
        document.getElementById('incomingCallModal').style.display = 'none';
    };
});

async function acceptCall(data) {
    document.getElementById('incomingCallModal').style.display = 'none';
    currentCallId = data.callId;
    
    try {
        const constraints = data.callType === 'video' 
            ? { audio: true, video: true } 
            : { audio: true, video: false };
        
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        
        peerConnection = new RTCPeerConnection(rtcConfig);
        
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
        
        peerConnection.ontrack = (event) => {
            document.getElementById('remoteVideo').srcObject = event.streams[0];
        };
        
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('ice candidate', { to: data.from, candidate: event.candidate });
            }
        };
        
        document.getElementById('localVideo').srcObject = localStream;
        if (data.callType === 'audio') {
            document.getElementById('localVideo').style.display = 'none';
        }
        
        socket.once('call offer', async (offerData) => {
            if (offerData.callId === currentCallId) {
                await peerConnection.setRemoteDescription(offerData.offer);
                const answer = await peerConnection.createAnswer();
                await peerConnection.setLocalDescription(answer);
                socket.emit('call answer', { callId: currentCallId, answer });
            }
        });
        
        showCallWindow(data.from, data.callType);
    } catch (err) {
        alert('Ошибка доступа к медиа: ' + err.message);
    }
}

socket.on('call answered', async (data) => {
    if (data.callId === currentCallId && peerConnection) {
        await peerConnection.setRemoteDescription(data.answer);
        startCallTimer();
    }
});

socket.on('ice candidate', async (data) => {
    if (peerConnection) {
        await peerConnection.addIceCandidate(data.candidate);
    }
});

socket.on('call rejected', () => {
    alert('Звонок отклонён');
    endCall();
});

socket.on('call ended', () => {
    endCall();
});

function showCallWindow(partner, callType) {
    document.getElementById('callPartner').textContent = partner;
    document.getElementById('callWindow').style.display = 'flex';
    startCallTimer();
}

function startCallTimer() {
    callStartTime = Date.now();
    callTimer = setInterval(() => {
        const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
        const min = String(Math.floor(elapsed / 60)).padStart(2, '0');
        const sec = String(elapsed % 60).padStart(2, '0');
        document.getElementById('callTimer').textContent = min + ':' + sec;
    }, 1000);
}

document.getElementById('endCallBtn').addEventListener('click', () => {
    if (selectedUser) {
        socket.emit('call end', { callId: currentCallId, to: selectedUser });
    }
    endCall();
});

function endCall() {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    if (callTimer) {
        clearInterval(callTimer);
        callTimer = null;
    }
    document.getElementById('callWindow').style.display = 'none';
    document.getElementById('localVideo').style.display = 'block';
    currentCallId = null;
}

document.getElementById('muteBtn').addEventListener('click', (e) => {
    if (localStream) {
        const audioTrack = localStream.getAudioTracks()[0];
        audioTrack.enabled = !audioTrack.enabled;
        e.target.classList.toggle('active');
    }
});

document.getElementById('cameraBtn').addEventListener('click', (e) => {
    if (localStream) {
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = !videoTrack.enabled;
            e.target.classList.toggle('active');
        }
    }
});

// === Уведомления ===
function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
}

function showNotification(text) {
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('Новое сообщение', { body: text });
    }
}

// === Утилиты ===
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}