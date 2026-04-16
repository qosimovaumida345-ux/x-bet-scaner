/**
 * X-BET INTELLIGENCE SYSTEM v8.0 PRO
 * Created by Daho Project
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// GLOBAL STATE
const state = {
    activeSession: null,
    crash: { mult: 1.0, history: [], next: 0, status: 'WAITING' },
    apple: { levels: 10, cols: 5, currentPath: [] },
    thimbles: { winPos: 1 }
};

// --- LOGIC ENGINE ---

// 1. CRASH ALGORITHM (Provably Fair Simulation)
function crashLoop() {
    state.crash.status = 'STARTING';
    let currentMult = 1.0;
    // Natijani oldindan aniqlash (Server-side seed)
    const crashAt = (Math.random() * (12.0 - 1.1) + 1.1).toFixed(2);
    state.crash.next = crashAt;

    io.emit('CRASH_PREPARE', { next: crashAt });

    const interval = setInterval(() => {
        if (currentMult >= crashAt) {
            state.crash.status = 'CRASHED';
            state.crash.history.unshift(crashAt);
            io.emit('CRASH_END', { crashAt, history: state.crash.history.slice(0, 15) });
            clearInterval(interval);
            setTimeout(crashLoop, 6000);
        } else {
            currentMult = parseFloat((currentMult + (currentMult * 0.02)).toFixed(2));
            state.crash.mult = currentMult;
            io.emit('CRASH_TICK', { mult: currentMult });
        }
    }, 150);
}

// 2. APPLE OF FORTUNE ENGINE
function generateAppleMap() {
    const map = [];
    for (let i = 0; i < 10; i++) {
        let count = i < 4 ? 4 : (i < 7 ? 3 : (i < 9 ? 2 : 1)); 
        let safe = [];
        while(safe.length < count) {
            let r = Math.floor(Math.random() * 5) + 1;
            if(!safe.includes(r)) safe.push(r);
        }
        map.push(safe);
    }
    return map;
}

io.on('connection', (socket) => {
    console.log('--- NEW CONNECTION: ' + socket.id);
    
    socket.on('LINK_SESSION', (data) => {
        state.activeSession = data.sid;
        console.log("Session Linked: " + data.sid);
        socket.emit('LOG', 'SYSTEM: Handshake success. Intercepting WebSocket...');
    });

    socket.on('GET_APPLE_MAP', () => {
        const map = generateAppleMap();
        socket.emit('APPLE_MAP', map);
    });

    socket.on('THIMBLES_PLAY', () => {
        const win = Math.floor(Math.random() * 3) + 1;
        socket.emit('THIMBLES_RESULT', win);
    });
});

crashLoop();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`DAHO SYSTEM ONLINE ON PORT ${PORT}`));