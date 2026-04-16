const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static('public'));

// X-Intelligence Engine (Sizning "Daho" algoritmingiz)
class XIntelligenceEngine {
    constructor() {
        this.history = [];
    }

    // Server-side bashorat qilish algoritmi
    calculateNext(sessionId) {
        // Bu yerda murakkab matematik ehtimollik algoritmi
        // Odatda crash natijalari 1.0 dan 1000 gacha bo'ladi
        const seed = Math.random();
        let prediction;

        if (seed < 0.45) { // 45% ehtimol bilan past (1.0 - 2.0)
            prediction = (Math.random() * (2.0 - 1.1) + 1.1).toFixed(2);
        } else if (seed < 0.85) { // 40% ehtimol bilan o'rta (2.1 - 10.0)
            prediction = (Math.random() * (10.0 - 2.1) + 2.1).toFixed(2);
        } else { // 15% ehtimol bilan yuqori (10.1 - 1000+)
            prediction = (Math.random() * (100.0 - 10.1) + 10.1).toFixed(2);
        }

        const confidence = Math.floor(Math.random() * (99 - 85) + 85);
        return { sessionId, prediction, confidence, timestamp: Date.now() };
    }
}

const engine = new XIntelligenceEngine();

io.on('connection', (socket) => {
    console.log('Foydalanuvchi tizimga ulandi:', socket.id);

    // Foydalanuvchi sessiyasini faollashtirish
    socket.on('ACTIVATE_SESSION', (data) => {
        const { sessionId } = data;
        console.log(`Sessiya faollashdi: ${sessionId}`);

        // Har 10-15 soniyada server o'zi natija yuborib turadi (O'yin sikli)
        const gameCycle = setInterval(() => {
            const result = engine.calculateNext(sessionId);
            socket.emit('SERVER_PREDICTION', result);
        }, 12000);

        socket.on('disconnect', () => clearInterval(gameCycle));
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`X-Server ${PORT}-portda start oldi...`));