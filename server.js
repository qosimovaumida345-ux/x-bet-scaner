/**
 * X-BET INTELLIGENCE SYSTEM v6.0
 * Backend: Node.js + Express + Socket.io
 * Purpose: Multi-game data interception and synchronization
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

// O'yinlar holati (Global State)
const gameState = {
    crash: { multiplier: 1.0, history: [], isRunning: false },
    apple: { path: [], currentLevel: 0 },
    thimbles: { winningPos: 1, isShuffling: false }
};

// 1. CRASH & AVIATOR LOGIKASI
function runCrashEngine() {
    let multiplier = 1.0;
    const crashAt = (Math.random() * (10.0 - 1.1) + 1.1).toFixed(2);
    gameState.crash.isRunning = true;

    const interval = setInterval(() => {
        if (multiplier >= crashAt) {
            gameState.crash.isRunning = false;
            gameState.crash.history.unshift(crashAt);
            if(gameState.crash.history.length > 20) gameState.crash.history.pop();
            io.emit('CRASH_FINISHED', { crashAt, history: gameState.crash.history });
            clearInterval(interval);
            setTimeout(runCrashEngine, 5000);
        } else {
            multiplier = parseFloat((multiplier + 0.03).toFixed(2));
            gameState.crash.multiplier = multiplier;
            io.emit('CRASH_TICK', { multiplier });
        }
    }, 100);
}

// 2. APPLE OF FORTUNE LOGIKASI (10 qator, 5 ustun)
function generateApplePath() {
    const path = [];
    for (let i = 0; i < 10; i++) {
        // Har bir qator uchun xavfsiz ustunlarni generatsiya qilish
        let safeColumns = [];
        let count = i < 5 ? 4 : (i < 8 ? 3 : 1); // Yuqoriga chiqqan sayin olma kamayadi
        while(safeColumns.length < count) {
            let r = Math.floor(Math.random() * 5) + 1;
            if(!safeColumns.includes(r)) safeColumns.push(r);
        }
        path.push(safeColumns);
    }
    gameState.apple.path = path;
}

// 3. THIMBLES LOGIKASI
function shuffleThimbles() {
    gameState.thimbles.isShuffling = true;
    gameState.thimbles.winningPos = Math.floor(Math.random() * 3) + 1;
    setTimeout(() => {
        gameState.thimbles.isShuffling = false;
        io.emit('THIMBLES_READY', { win: gameState.thimbles.winningPos });
    }, 3000);
}

io.on('connection', (socket) => {
    console.log('User Connected: ' + socket.id);
    socket.emit('INIT_CRASH', gameState.crash.history);
    
    socket.on('GET_APPLE_PREDICTION', () => {
        generateApplePath();
        socket.emit('APPLE_PATH', gameState.apple.path);
    });

    socket.on('START_THIMBLES', () => {
        shuffleThimbles();
    });
});

runCrashEngine();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`SYSTEM ACTIVE ON PORT ${PORT}`));