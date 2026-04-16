/**
 * ============================================================
 * X-INTEL INTELLIGENCE SYSTEM v13.0 - DAHO EDITION
 * Backend: Node.js + Express + Socket.io + OpenRouter AI
 * Dynamic Free Model Selector + Session ID Based Analysis
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
// GLOBAL CONFIG
// ============================================================
const CONFIG = {
    PORT: process.env.PORT || 3000,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || '',
    SITE_URL: process.env.SITE_URL || 'https://x-bet-scaner.onrender.com',
    SITE_NAME: 'X-Intel Intelligence System v13',
    // Preferred bepul modellar (ustuvorlik tartibi)
    PREFERRED_FREE_MODELS: [
        'meta-llama/llama-3.1-8b-instruct:free',
        'meta-llama/llama-3.2-3b-instruct:free',
        'meta-llama/llama-3.2-1b-instruct:free',
        'google/gemma-2-9b-it:free',
        'google/gemma-7b-it:free',
        'mistralai/mistral-7b-instruct:free',
        'qwen/qwen-2-7b-instruct:free',
        'microsoft/phi-3-mini-128k-instruct:free',
        'huggingfaceh4/zephyr-7b-beta:free',
        'openchat/openchat-7b:free'
    ]
};

// ============================================================
// IN-MEMORY DATABASE
// ============================================================
const Database = {
    sessions: new Map(),
    gameHistory: new Map(),
    predictions: new Map(),
    cachedFreeModel: null,
    modelCachedAt: null,

    saveSession(socketId, data) {
        this.sessions.set(socketId, {
            ...data,
            connectedAt: new Date().toISOString(),
            requestCount: 0
        });
        console.log(`[DB] Session saved for socket: ${socketId}`);
    },

    getSession(socketId) {
        return this.sessions.get(socketId) || null;
    },

    incrementRequest(socketId) {
        const session = this.sessions.get(socketId);
        if (session) {
            session.requestCount++;
            this.sessions.set(socketId, session);
        }
    },

    addHistory(socketId, gameType, result) {
        if (!this.gameHistory.has(socketId)) {
            this.gameHistory.set(socketId, []);
        }
        const history = this.gameHistory.get(socketId);
        history.unshift({
            gameType,
            result,
            time: new Date().toLocaleTimeString()
        });
        if (history.length > 100) history.pop();
        this.gameHistory.set(socketId, history);
    },

    getHistory(socketId, gameType) {
        const all = this.gameHistory.get(socketId) || [];
        return gameType ? all.filter(h => h.gameType === gameType) : all;
    },

    savePrediction(socketId, prediction) {
        this.predictions.set(socketId, {
            ...prediction,
            savedAt: new Date().toISOString()
        });
    },

    clearSession(socketId) {
        this.sessions.delete(socketId);
        this.gameHistory.delete(socketId);
        this.predictions.delete(socketId);
        console.log(`[DB] Session cleared for socket: ${socketId}`);
    }
};

// ============================================================
// FREE MODEL SELECTOR (Dynamic)
// ============================================================
const ModelSelector = {

    async getFreeModel() {
        // Cache: har 30 daqiqada bir marta yangilash
        const now = Date.now();
        if (
            Database.cachedFreeModel &&
            Database.modelCachedAt &&
            (now - Database.modelCachedAt) < 30 * 60 * 1000
        ) {
            console.log(`[MODEL] Cache dan: ${Database.cachedFreeModel}`);
            return Database.cachedFreeModel;
        }

        try {
            console.log('[MODEL] OpenRouter dan bepul modellar yuklanmoqda...');

            const response = await axios.get(
                'https://openrouter.ai/api/v1/models',
                {
                    headers: {
                        'Authorization': `Bearer ${CONFIG.OPENROUTER_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000
                }
            );

            const allModels = response.data.data || [];

            // Bepul modellarni filtr
            const freeModels = allModels.filter(model => {
                const promptPrice = parseFloat(model.pricing?.prompt || '1');
                const completionPrice = parseFloat(model.pricing?.completion || '1');
                return (
                    promptPrice === 0 &&
                    completionPrice === 0 ||
                    model.id.includes(':free')
                );
            });

            console.log(`[MODEL] Topilgan bepul modellar soni: ${freeModels.length}`);
            freeModels.forEach(m => console.log(`  - ${m.id}`));

            // Preferred modellardan birini tanlash
            for (const preferred of CONFIG.PREFERRED_FREE_MODELS) {
                const found = freeModels.find(m => m.id === preferred);
                if (found) {
                    console.log(`[MODEL] TANLANDI: ${found.id}`);
                    Database.cachedFreeModel = found.id;
                    Database.modelCachedAt = now;
                    return found.id;
                }
            }

            // Preferred bo'lmasa, birinchi bepulni olish
            if (freeModels.length > 0) {
                const fallback = freeModels[0].id;
                console.log(`[MODEL] FALLBACK: ${fallback}`);
                Database.cachedFreeModel = fallback;
                Database.modelCachedAt = now;
                return fallback;
            }

            throw new Error('OpenRouter da hech qanday bepul model topilmadi!');

        } catch (error) {
            console.error('[MODEL ERROR]', error.message);

            // Agar API chaqiruv o'zi ishlamasa, default dan foydalanish
            const defaultModel = CONFIG.PREFERRED_FREE_MODELS[0];
            console.log(`[MODEL] DEFAULT ISHLATILMOQDA: ${defaultModel}`);
            return defaultModel;
        }
    }
};

// ============================================================
// SESSION ID ORQALI 1XBET DAN MA'LUMOT OLISH
// ============================================================
const XBetFetcher = {

    // 1xBet dan mavjud o'yin ma'lumotlarini olish
    async fetchGameData(sessionId, gameType) {
        const gameEndpoints = {
            apple: 'https://1xbet.com/api/en/apple-of-fortune/getGame',
            crash: 'https://1xbet.com/api/en/crash/getGame',
            thimbles: 'https://1xbet.com/api/en/thimbles/getGame'
        };

        const headers = {
            'Cookie': `v_sid=${sessionId}`,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': 'https://1xbet.com/',
            'Origin': 'https://1xbet.com',
            'X-Requested-With': 'XMLHttpRequest'
        };

        try {
            const response = await axios.get(
                gameEndpoints[gameType] || gameEndpoints.apple,
                { headers, timeout: 15000 }
            );
            return { success: true, data: response.data };
        } catch (error) {
            console.error(`[FETCHER] ${gameType} ma'lumot olishda xato:`, error.message);
            return { success: false, error: error.message };
        }
    },

    // Active game holatini tekshirish
    async fetchActiveGame(sessionId, gameType) {
        const activeEndpoints = {
            apple: 'https://1xbet.com/api/en/apple-of-fortune/getActiveGame',
            crash: 'https://1xbet.com/api/en/crash/getActiveGame',
            thimbles: 'https://1xbet.com/api/en/thimbles/getActiveGame'
        };

        const headers = {
            'Cookie': `v_sid=${sessionId}`,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': 'https://1xbet.com/',
            'Origin': 'https://1xbet.com'
        };

        try {
            const response = await axios.get(
                activeEndpoints[gameType] || activeEndpoints.apple,
                { headers, timeout: 15000 }
            );
            return { success: true, data: response.data };
        } catch (error) {
            console.error(`[FETCHER] Active game xato:`, error.message);
            return { success: false, error: error.message };
        }
    },

    // Coefficients tarixini olish
    async fetchCoefficients(sessionId, gameType) {
        const coeffEndpoints = {
            apple: 'https://1xbet.com/api/en/apple-of-fortune/GetCoefficients',
            crash: 'https://1xbet.com/api/en/crash/GetCoefficients',
            thimbles: 'https://1xbet.com/api/en/thimbles/GetCoefficients'
        };

        const headers = {
            'Cookie': `v_sid=${sessionId}`,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*'
        };

        try {
            const response = await axios.get(
                `${coeffEndpoints[gameType]}?language=en&demo=2`,
                { headers, timeout: 15000 }
            );
            return { success: true, data: response.data };
        } catch (error) {
            console.error(`[FETCHER] Coefficients xato:`, error.message);
            return { success: false, error: error.message };
        }
    }
};

// ============================================================
// AI ENGINE (OpenRouter + Dynamic Model)
// ============================================================
const AIEngine = {

    buildMasterPrompt(gameType, sessionData, activeGame, coefficients, userHistory) {
        return `
Sen 1xBet kazino o'yinlari uchun professional ma'lumot tahlilchisan.
Sening vazifang: Serverdan kelgan HAQIQIY ma'lumotlarni tahlil qilib, foydalanuvchiga keyingi eng xavfsiz qadam haqida maslahat berish.

===== O'YIN TURI: ${gameType.toUpperCase()} =====

===== SESSION MA'LUMOTLARI =====
Session Muvaffaqiyati: ${sessionData.success ? 'HA' : "YO'Q"}
Xato: ${sessionData.error || 'YOQ'}
Raw Data: ${JSON.stringify(sessionData.data, null, 2)}

===== AKTIV O'YIN HOLATI =====
Muvaffaqiyat: ${activeGame.success ? 'HA' : "YO'Q"}
Raw Data: ${JSON.stringify(activeGame.data, null, 2)}

===== KOEFFITSIYENTLAR TARIXI =====
Muvaffaqiyat: ${coefficients.success ? 'HA' : "YO'Q"}
Raw Data: ${JSON.stringify(coefficients.data, null, 2)}

===== FOYDALANUVCHI OLDINGI NATIJALARI =====
${userHistory.length > 0 ? JSON.stringify(userHistory.slice(0, 10), null, 2) : 'Birinchi urinish - tarix yoq'}

===== TAHLIL VA BASHORAT =====
${this.getGameSpecificInstructions(gameType)}

===== JAVOB FORMATI =====
Faqat quyidagi JSON formatida javob ber, boshqa hech narsa yozma:
${this.getResponseFormat(gameType)}
`;
    },

    getGameSpecificInstructions(gameType) {
        const instructions = {
            apple: `
APPLE OF FORTUNE QOIDALARI:
- 10 ta qator, har qatorda 5 ta katak
- Har qatorda 1 ta katak tanlash kerak
- To'g'ri katakda yashirin olma bor
- Qavat ko'tarilgan sayin xavfli kataklar ko'payadi
- NSW (Next Step Win) koeffitsienti keyingi qadamning xavf darajasini bildiradi
- UC (User Choices) - foydalanuvchi allaqachon tanlagan kataklar
- AI (Game ID) - bu o'yinning noyob identifikatori, undan pattern topishga harakat qil
- SB=1 yangi o'yin boshlandi degani
- CF=0 hali birorta qadam qo'yilmagan degani

VAZIFANG:
1. Game ID raqamini tahlil qil (oxirgi raqamlar, juft/toq, yig'indisi)
2. NSW koeffitsienti asosida xavf darajasini baholay
3. Koeffitsiyentlar tarixidan pattern top
4. Keyingi xavfsiz ustunni (1 dan 5 gacha) aniqlash`,

            crash: `
CRASH/AVIATOR QOIDALARI:
- Samolyot/raketa koeffitsiyent oshiradi
- Istalgan vaqtda "Cash Out" qilish mumkin
- Koeffitsiyent portlashidan oldin chiqish kerak

VAZIFANG:
1. Oxirgi 20 ta natijadan pattern top
2. Ehtimollik nazariyasi asosida keyingi crash nuqtasini bashorat qil
3. Xavfsiz chiqish nuqtasini aniqlash`,

            thimbles: `
THIMBLES QOIDALARI:
- 3 ta stakan, bittasida sharcha
- Stakanchalar aralashtiriladi
- To'g'ri stakanni topish kerak

VAZIFANG:
1. Oldingi natijalardan pattern top
2. Qaysi stakan ko'p yutgan/yutqizgan tahlil qil
3. Keyingi g'olib stakanni bashorat qil`
        };

        return instructions[gameType] || instructions.apple;
    },

    getResponseFormat(gameType) {
        const formats = {
            apple: `{
  "recommended_column": 3,
  "confidence": 87,
  "reasoning": "Game ID va NSW tahlili asosida...",
  "risk_level": "LOW",
  "next_multiplier": 1.23,
  "alternative_columns": [1, 5],
  "pattern_found": "tarixdan topilgan pattern",
  "warning": "agar biror ogohlantirish bo'lsa"
}`,
            crash: `{
  "predicted_crash": 2.45,
  "confidence": 82,
  "reasoning": "Oxirgi natijalarga asosan...",
  "safe_exit": 1.8,
  "trend": "UP",
  "risk_level": "MEDIUM",
  "pattern_found": "tarixdan topilgan pattern"
}`,
            thimbles: `{
  "winning_position": 2,
  "confidence": 75,
  "reasoning": "Tarixdan...",
  "alternative_position": 1,
  "risk_level": "LOW",
  "pattern_found": "pattern"
}`
        };

        return formats[gameType] || formats.apple;
    },

    async analyze(gameType, sessionId, userHistory) {
        if (!CONFIG.OPENROUTER_API_KEY) {
            throw new Error('OPENROUTER_API_KEY topilmadi! Render ENV ga qoshing.');
        }

        // 1. Bepul modelni dinamik tanlash
        const model = await ModelSelector.getFreeModel();
        console.log(`[AI] Tanlangan model: ${model}`);

        // 2. Session ID orqali 1xBet dan ma'lumot olish
        console.log(`[AI] 1xBet dan ma'lumot yuklanmoqda... Session: ${sessionId.substring(0, 10)}...`);

        const [sessionData, activeGame, coefficients] = await Promise.allSettled([
            XBetFetcher.fetchGameData(sessionId, gameType),
            XBetFetcher.fetchActiveGame(sessionId, gameType),
            XBetFetcher.fetchCoefficients(sessionId, gameType)
        ]);

        const sessionResult = sessionData.status === 'fulfilled' ? sessionData.value : { success: false, error: sessionData.reason };
        const activeResult = activeGame.status === 'fulfilled' ? activeGame.value : { success: false, error: activeGame.reason };
        const coeffResult = coefficients.status === 'fulfilled' ? coefficients.value : { success: false, error: coefficients.reason };

        console.log('[AI] 1xBet ma\'lumotlari:', {
            session: sessionResult.success,
            active: activeResult.success,
            coeff: coeffResult.success
        });

        // 3. Master prompt yaratish
        const prompt = this.buildMasterPrompt(
            gameType,
            sessionResult,
            activeResult,
            coeffResult,
            userHistory
        );

        // 4. OpenRouter AI ga yuborish
        console.log(`[AI] OpenRouter ga yuborilmoqda: ${model}`);

        const response = await axios.post(
            'https://openrouter.ai/api/v1/chat/completions',
            {
                model: model,
                messages: [
                    {
                        role: 'system',
                        content: 'Sen professional kazino o\'yinlari tahlilchisan. Har doim faqat sof JSON formatida javob ber. Hech qanday markdown, kod bloki yoki qo\'shimcha matn yozma. Faqat { } ichidagi JSON.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: 0.2,
                max_tokens: 800,
                top_p: 0.9
            },
            {
                headers: {
                    'Authorization': `Bearer ${CONFIG.OPENROUTER_API_KEY}`,
                    'HTTP-Referer': CONFIG.SITE_URL,
                    'X-Title': CONFIG.SITE_NAME,
                    'Content-Type': 'application/json'
                },
                timeout: 45000
            }
        );

        const rawContent = response.data.choices[0].message.content;
        console.log('[AI] Raw javob:', rawContent);

        // JSON ni tozalash va parse qilish
        const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error('AI JSON formatida javob bermadi: ' + rawContent.substring(0, 200));
        }

        const parsed = JSON.parse(jsonMatch[0]);
        console.log('[AI] Parse qilindi:', parsed);

        return {
            prediction: parsed,
            model: model,
            dataFetched: {
                sessionSuccess: sessionResult.success,
                activeSuccess: activeResult.success,
                coeffSuccess: coeffResult.success
            }
        };
    }
};

// ============================================================
// SOCKET.IO EVENT HANDLERS
// ============================================================
io.on('connection', (socket) => {
    console.log(`\n[SOCKET] YANGI ULANISH: ${socket.id}`);

    // Ulanish tasdig'i
    socket.emit('SYSTEM_READY', {
        message: 'X-Intel Intelligence System v13.0 tayyor',
        timestamp: new Date().toISOString()
    });

    // Model ma'lumotini oldindan yuklash
    ModelSelector.getFreeModel().then(model => {
        socket.emit('MODEL_SELECTED', { model });
        socket.emit('LOG', `[SYSTEM] Tanlangan model: ${model}`);
    });

    // Session ID saqlash
    socket.on('SAVE_SESSION', (data) => {
        const { sessionId, gameType } = data;
        if (!sessionId) {
            socket.emit('LOG', '[ERROR] Session ID kiritilmadi!');
            return;
        }
        Database.saveSession(socket.id, { sessionId, gameType });
        socket.emit('LOG', `[SESSION] ID saqlandi: ${sessionId.substring(0, 8)}...`);
        socket.emit('SESSION_SAVED', { success: true });
    });

    // AI Tahlil boshlash
    socket.on('START_ANALYSIS', async (data) => {
        const { gameType } = data;

        try {
            const session = Database.getSession(socket.id);
            const sessionId = session?.sessionId || data.sessionId;

            if (!sessionId) {
                socket.emit('AI_ERROR', { message: 'Session ID kiritilmagan! Avval Session ID kiriting.' });
                return;
            }

            Database.incrementRequest(socket.id);
            const userHistory = Database.getHistory(socket.id, gameType);

            socket.emit('ANALYZING', true);
            socket.emit('LOG', `[AI] Tahlil boshlandi: ${gameType.toUpperCase()}`);
            socket.emit('LOG', `[AI] Session ID orqali 1xBet dan ma'lumot olinmoqda...`);

            // AI tahlil
            const result = await AIEngine.analyze(gameType, sessionId, userHistory);

            // Natijani saqlash
            Database.savePrediction(socket.id, result.prediction);
            Database.addHistory(socket.id, gameType, result.prediction);

            socket.emit('ANALYZING', false);
            socket.emit('LOG', `[AI] Tahlil muvaffaqiyatli yakunlandi!`);
            socket.emit('LOG', `[MODEL] ${result.model}`);
            socket.emit('LOG', `[DATA] Session: ${result.dataFetched.sessionSuccess}, Active: ${result.dataFetched.activeSuccess}, Coeff: ${result.dataFetched.coeffSuccess}`);

            socket.emit('AI_PREDICTION', {
                gameType,
                prediction: result.prediction,
                model: result.model,
                dataFetched: result.dataFetched,
                timestamp: new Date().toLocaleTimeString()
            });

        } catch (error) {
            console.error('[SOCKET ERROR]', error.message);
            socket.emit('ANALYZING', false);
            socket.emit('LOG', `[ERROR] ${error.message}`);
            socket.emit('AI_ERROR', { message: error.message });
        }
    });

    // Tarixni olish
    socket.on('GET_HISTORY', (data) => {
        const history = Database.getHistory(socket.id, data?.gameType);
        socket.emit('HISTORY_DATA', history);
    });

    // Ulanish uzilganda
    socket.on('disconnect', () => {
        console.log(`[SOCKET] UZILDI: ${socket.id}`);
        Database.clearSession(socket.id);
    });
});

// ============================================================
// HTTP API ROUTES
// ============================================================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        uptime: Math.floor(process.uptime()),
        connections: io.engine.clientsCount,
        apiKey: !!CONFIG.OPENROUTER_API_KEY,
        cachedModel: Database.cachedFreeModel,
        timestamp: new Date().toISOString()
    });
});

app.get('/api/models', async (req, res) => {
    try {
        const model = await ModelSelector.getFreeModel();
        res.json({ selectedModel: model, cachedAt: Database.modelCachedAt });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ============================================================
// GLOBAL ERROR HANDLERS
// ============================================================
process.on('uncaughtException', (err) => {
    console.error('[UNCAUGHT EXCEPTION]', err.message);
});

process.on('unhandledRejection', (reason) => {
    console.error('[UNHANDLED REJECTION]', reason);
});

// ============================================================
// START SERVER
// ============================================================
httpServer.listen(CONFIG.PORT, () => {
    console.log('\n============================================================');
    console.log('   X-INTEL INTELLIGENCE SYSTEM v13.0 - ONLINE');
    console.log(`   PORT     : ${CONFIG.PORT}`);
    console.log(`   API KEY  : ${CONFIG.OPENROUTER_API_KEY ? 'CONFIGURED ✓' : 'MISSING ✗'}`);
    console.log(`   SITE URL : ${CONFIG.SITE_URL}`);
    console.log('============================================================\n');

    // Server ishga tushganida bepul modelni oldindan yuklash
    ModelSelector.getFreeModel().then(model => {
        console.log(`[STARTUP] Tayyor model: ${model}`);
    }).catch(err => {
        console.error('[STARTUP] Model yuklanmadi:', err.message);
    });
});

module.exports = { app, io };