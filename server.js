const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

// Ma'lumotlarni saqlash
let currentMultiplier = 1.0;
let isCrashed = false;
let history = [];

// Har 5 soniyada yangi o'yin simulyatsiyasi
function startNewRound() {
    isCrashed = false;
    currentMultiplier = 1.0;
    const crashPoint = (Math.random() * (15.0 - 1.1) + 1.1).toFixed(2);
    
    let interval = setInterval(() => {
        if (currentMultiplier >= crashPoint) {
            isCrashed = true;
            history.unshift(crashPoint);
            if(history.length > 10) history.pop();
            io.emit('GAME_CRASHED', { crashPoint, history });
            clearInterval(interval);
            setTimeout(startNewRound, 4000); // 4 soniya tanaffus
        } else {
            currentMultiplier = parseFloat((currentMultiplier + 0.05).toFixed(2));
            io.emit('TICK', { multiplier: currentMultiplier });
        }
    }, 100);
}

io.on('connection', (socket) => {
    socket.emit('INIT_HISTORY', history);
});

startNewRound();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Daho tizimi ${PORT}-portda yondi`));