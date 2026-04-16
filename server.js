/**
 * ============================================================
 * X-INTEL INTELLIGENCE SYSTEM v12.0 - DAHO EDITION
 * Backend: Node.js + Express + Socket.io + OpenRouter AI
 * Author: Daho Project
 * Description: Real AI-powered 1xBet game analyzer
 * ============================================================
 */

'use strict';

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');
const path = require('path');
const cors = require('cors');
require('dotenv').config();

// ============================================================
// APP INITIALIZATION
// ============================================================
const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    pingTimeout: 60000,
    pingInterval: 25000
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// ENVIRONMENT VARIABLES (Render ENV dan olinadi)
// ============================================================
const CONFIG = {
    PORT: process.env.PORT || 3000,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || '',
    MODEL: 'anthropic/claude-sonnet-4-5',
    SITE_URL: process.env.SITE_URL || 'https://x-bet-scaner.onrender.com',
    SITE_NAME: 'X-Intel Intelligence System'
};

// ============================================================
// IN-MEMORY DATABASE (Sessiya ma'lumotlarini saqlash)
// ============================================================
const Database = {
    sessions: new Map(),
    gameHistory: new Map(),
    predictions: new Map(),

    saveSession(socketId, data) {
        this.sessions.set(socketId, {
            ...data,
            connectedAt: new Date().toISOString(),
            requestCount: 0
        });
    },

    getSession(socketId) {
        return this.sessions.get(socketId) || null;
    },

    addHistory(socketId, gameType, result) {
        if (!this.gameHistory.has(socketId)) {
            this.gameHistory.set(socketId, []);
        }
        const history = this.gameHistory.get(socketId);
        history.unshift({ gameType, result, time: new Date().toLocaleTimeString() });
        if (history.length > 50) history.pop();
        this.gameHistory.set(socketId, history);
    },

    getHistory(socketId) {
        return this.gameHistory.get(socketId) || [];
    },

    savePrediction(socketId, prediction) {
        this.predictions.set(socketId, prediction);
    },

    getPrediction(socketId) {
        return this.predictions.get(socketId) || null;
    },

    clearSession(socketId) {
        this.sessions.delete(socketId);
        this.gameHistory.delete(socketId);
        this.predictions.delete(socketId);
    }
};

// ============================================================
// OPENROUTER AI ENGINE
// ============================================================
const AIEngine = {

    // Apple of Fortune uchun maxsus prompt
    buildApplePrompt(packetData, history) {
        return `
Sen 1xBet "Apple of Fortune" o'yini uchun professional tahlilchisan.

O'YIN QOIDALARI:
- Har bir qatorda 5 ta katak bor
- Faqat ba'zi kataklar xavfsiz (olma bor)
- Har qatorda faqat 1 ta katak tanlash kerak
- Qavat ko'tarilgan sayin xavfsiz kataklar kamayadi

SERVERDAN KELGAN PAKET:
${JSON.stringify(packetData, null, 2)}

PAKET PARAMETRLARI TAHLILI:
- SB (Session Begin): ${packetData.SB} - Sessiya holati
- CF (Current Factor): ${packetData.CF} - Joriy koeffitsiyent
- SW (Step Win): ${packetData.SW} - Qadam yutishi
- RS.UC (User Choices): ${JSON.stringify(packetData.RS?.UC)} - Foydalanuvchi tanlagan kataklar
- RS.NSW (Next Step Win): ${packetData.RS?.NSW} - Keyingi qadam koeffitsienti
- AI (Game ID): ${packetData.AI} - O'yin identifikatori
- AN (Attempt Number): ${packetData.AN} - Urinish raqami
- BS (Bet Status): ${packetData.BS} - Bet holati

OLDINGI TARIXDAN PATTERN:
${history.length > 0 ? JSON.stringify(history.slice(0, 10)) : 'Tarix yo\'q - birinchi urinish'}

VAZIFANG:
1. Game ID (${packetData.AI}) ning raqamli xususiyatlarini tahlil qil
2. NSW (${packetData.RS?.NSW}) koeffitsienti asosida xavf darajasini baholay
3. UC massivi bo'sh ([]) ekanini hisobga olib (yangi o'yin boshlangan)
4. Keyingi xavfsiz ustunni (1-5) aniqlash

JAVOB FORMATI (faqat JSON):
{
  "recommended_column": 3,
  "confidence": 87,
  "reasoning": "Game ID oxirgi 3 raqami...",
  "risk_level": "LOW/MEDIUM/HIGH",
  "next_multiplier": 1.23
}`;
    },

    // Crash / Aviator uchun maxsus prompt
    buildCrashPrompt(packetData, history) {
        return `
Sen 1xBet "Crash/Aviator" o'yini uchun professional statistik tahlilchisan.

SERVERDAN KELGAN PAKET:
${JSON.stringify(packetData, null, 2)}

OXIRGI 10 TA NATIJA TARIXI:
${history.length > 0 ? history.slice(0, 10).join(', ') : 'Tarix yo\'q'}

VAZIFANG:
- Paket ichidagi barcha raqamlarni tahlil qil
- Oxirgi natijalardagi pattern va trendni hisobga ol
- Ehtimollik nazariyasidan foydalanib keyingi crash nuqtasini bashorat qil

JAVOB FORMATI (faqat JSON):
{
  "predicted_crash": 2.45,
  "confidence": 82,
  "reasoning": "Oxirgi 5 ta natija past bo'lgani uchun...",
  "safe_exit": 1.8,
  "trend": "UP/DOWN/STABLE"
}`;
    },

    // Thimbles uchun maxsus prompt
    buildThimblesPrompt(packetData, history) {
        return `
Sen 1xBet "Thimbles" o'yini uchun tahlilchisan.

PAKET:
${JSON.stringify(packetData, null, 2)}

TARIX:
${JSON.stringify(history.slice(0, 10))}

VAZIFANG:
- 3 ta stakandan qaysi birida sharcha borligini bashorat qil
- Paketdagi raqamlardan pattern topishga harakat qil

JAVOB FORMATI (faqat JSON):
{
  "winning_position": 2,
  "confidence": 75,
  "reasoning": "...",
  "alternative_position": 1
}`;
    },

    // OpenRouter API ga so'rov yuborish
    async analyze(gameType, packetData, history) {
        if (!CONFIG.OPENROUTER_API_KEY) {
            throw new Error('OPENROUTER_API_KEY topilmadi! Render ENV ga qo\'shing.');
        }

        let prompt = '';
        switch (gameType) {
            case 'apple': prompt = this.buildApplePrompt(packetData, history); break;
            case 'crash': prompt = this.buildCrashPrompt(packetData, history); break;
            case 'thimbles': prompt = this.buildThimblesPrompt(packetData, history); break;
            default: throw new Error('Noma\'lum o\'yin turi: ' + gameType);
        }

        const requestBody = {
            model: CONFIG.MODEL,
            messages: [
                {
                    role: 'system',
                    content: 'Sen professional o\'yin tahlilchisan. Har doim faqat JSON formatida javob ber. Hech qanday qo\'shimcha matn yozma.'
                },
                {
                    role: 'user',
                    content: prompt
                }
            ],
            temperature: 0.3,
            max_tokens: 500
        };

        const response = await axios.post(
            'https://openrouter.ai/api/v1/chat/completions',
            requestBody,
            {
                headers: {
                    'Authorization': `Bearer ${CONFIG.OPENROUTER_API_KEY}`,
                    'HTTP-Referer': CONFIG.SITE_URL,
                    'X-Title': CONFIG.SITE_NAME,
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            }
        );

        const content = response.data.choices[0].message.content;

        // JSON ni tozalab parse qilish
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('AI JSON formatida javob bermadi');

        return JSON.parse(jsonMatch[0]);
    }
};

// ============================================================
// SOCKET.IO EVENT HANDLERS
// ============================================================
io.on('connection', (socket) => {
    console.log(`[+] CONNECTED: ${socket.id}`);

    // Foydalanuvchi ulanganida
    socket.emit('SYSTEM_READY', {
        message: 'X-Intel Intelligence System v12.0 tayyor',
        model: CONFIG.MODEL,
        timestamp: new Date().toISOString()
    });

    // Packet tahlili
    socket.on('ANALYZE_PACKET', async (data) => {
        const { gameType, rawJson } = data;

        try {
            socket.emit('LOG', `[${new Date().toLocaleTimeString()}] Paket qabul qilindi. O'yin: ${gameType}`);
            socket.emit('LOG', `[${new Date().toLocaleTimeString()}] OpenRouter AI ga so'rov yuborilmoqda...`);
            socket.emit('ANALYZING', true);

            // JSON ni parse qilish
            let packetData;
            try {
                packetData = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson;
            } catch (e) {
                throw new Error('Noto\'g\'ri JSON format. Iltimos, to\'g\'ri JSON kiriting.');
            }

            // Tarixni olish
            const history = Database.getHistory(socket.id);

            // AI ga yuborish
            const prediction = await AIEngine.analyze(gameType, packetData, history);

            // Natijani saqlash
            Database.savePrediction(socket.id, prediction);
            Database.addHistory(socket.id, gameType, prediction);

            socket.emit('LOG', `[${new Date().toLocaleTimeString()}] AI tahlil yakunlandi!`);
            socket.emit('ANALYZING', false);
            socket.emit('AI_PREDICTION', {
                gameType,
                prediction,
                timestamp: new Date().toLocaleTimeString(),
                packetSummary: {
                    gameId: packetData.AI || 'N/A',
                    nextWin: packetData.RS?.NSW || 'N/A',
                    sessionBegin: packetData.SB || 'N/A'
                }
            });

        } catch (error) {
            socket.emit('ANALYZING', false);
            socket.emit('LOG', `[ERROR] ${error.message}`);
            socket.emit('AI_ERROR', { message: error.message });
            console.error('[AI ERROR]', error.message);
        }
    });

    // Tarixni olish
    socket.on('GET_HISTORY', () => {
        const history = Database.getHistory(socket.id);
        socket.emit('HISTORY_DATA', history);
    });

    // Ulanish uzilganda
    socket.on('disconnect', () => {
        console.log(`[-] DISCONNECTED: ${socket.id}`);
        Database.clearSession(socket.id);
    });
});

// ============================================================
// HTTP ROUTES
// ============================================================
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        model: CONFIG.MODEL,
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

app.get('/api/status', (req, res) => {
    res.json({
        connections: io.engine.clientsCount,
        apiKeyConfigured: !!CONFIG.OPENROUTER_API_KEY,
        model: CONFIG.MODEL
    });
});

// ============================================================
// START SERVER
// ============================================================
httpServer.listen(CONFIG.PORT, () => {
    console.log('============================================================');
    console.log(' X-INTEL INTELLIGENCE SYSTEM v12.0 - ONLINE');
    console.log(`  PORT     : ${CONFIG.PORT}`);
    console.log(`  MODEL    : ${CONFIG.MODEL}`);
    console.log(`  API KEY  : ${CONFIG.OPENROUTER_API_KEY ? 'CONFIGURED ✓' : 'MISSING ✗'}`);
    console.log('============================================================');
});

module.exports = { app, io };