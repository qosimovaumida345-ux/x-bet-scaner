const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json()); // JSON ma'lumotlarni qabul qilish uchun

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

// Ma'lumotlarni vaqtinchalik saqlash
const sessionData = {};

io.on('connection', (socket) => {
    console.log('🌐 Qurilma ulandi:', socket.id);

    // Qurilmani maxsus xonaga ulaymiz (ID bo'yicha)
    socket.on('JOIN_SESSION', (sessionId) => {
        socket.join(sessionId);
        if (sessionData[sessionId]) {
            io.to(sessionId).emit('UPDATE_UI', sessionData[sessionId]);
        }
    });

    // Ma'lumotni qabul qilish va tarqatish
    socket.on('PUSH_DATA', (payload) => {
        const { sessionId, data } = payload;
        sessionData[sessionId] = data; // Oxirgi holatni saqlash
        io.to(sessionId).emit('UPDATE_UI', data);
    });

    socket.on('disconnect', () => {
        console.log('📴 Qurilma uzildi');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server ${PORT}-portda ishlamoqda`));