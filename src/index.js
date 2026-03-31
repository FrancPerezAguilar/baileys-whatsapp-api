const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@WhiskeySockets/baileys');
const express = require('express');
const cors = require('cors');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Store active connections
const sessions = new Map();

// Auth state directory
const AUTH_DIR = './auth';

// Ensure auth directory exists
if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
}

// Get or create session for a given ID
async function getOrCreateSock(sessionId) {
    if (sessions.has(sessionId)) {
        return sessions.get(sessionId);
    }

    const authDir = path.join(AUTH_DIR, sessionId);
    
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        defaultQuoted: false,
        generateHighQualityLinkPreview: true,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
        console.log(`[${sessionId}] Connection update:`, connection);
        
        if (qr) {
            console.log(`[${sessionId}] QR Code received`);
            // Store latest QR for this session
            sessionsQR.set(sessionId, qr);
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log(`[${sessionId}] Connection closed. Reconnect:`, shouldReconnect);
            
            if (shouldReconnect) {
                sessions.delete(sessionId);
                getOrCreateSock(sessionId);
            }
        } else if (connection === 'open') {
            console.log(`[${sessionId}] Connected successfully!`);
            sessionsQR.delete(sessionId);
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        for (const msg of messages) {
            console.log(`[${sessionId}] Message:`, msg.key?.remoteJid, msg.message?.conversation || msg.message?.extendedTextMessage?.text);
        }
    });

    sessions.set(sessionId, sock);
    return sock;
}

// Store latest QR codes
const sessionsQR = new Map();

// API Routes

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', sessions: sessions.size });
});

// Get QR code for a session
app.get('/qr/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    
    if (sessionsQR.has(sessionId)) {
        const qr = sessionsQR.get(sessionId);
        try {
            const qrImage = await QRCode.toDataURL(qr);
            res.json({ qr: qrImage });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    } else if (sessions.has(sessionId)) {
        const sock = sessions.get(sessionId);
        if (sock.ws.readyState === 1) {
            res.json({ connected: true });
        } else {
            res.json({ waiting: true });
        }
    } else {
        res.json({ waiting: true });
    }
});

// Create/start session
app.post('/session/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    
    try {
        await getOrCreateSock(sessionId);
        res.json({ success: true, message: 'Session started. Get QR code at /qr/' + sessionId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Send message
app.post('/send', async (req, res) => {
    const { sessionId, jid, text } = req.body;
    
    if (!sessionId || !jid || !text) {
        return res.status(400).json({ error: 'Missing sessionId, jid or text' });
    }
    
    try {
        const sock = sessions.get(sessionId);
        if (!sock) {
            return res.status(404).json({ error: 'Session not found. POST /session/:sessionId first' });
        }
        
        await sock.sendMessage(jid, { text });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Send text message to multiple recipients (broadcast)
app.post('/broadcast', async (req, res) => {
    const { sessionId, numbers, text } = req.body;
    
    if (!sessionId || !numbers || !text) {
        return res.status(400).json({ error: 'Missing sessionId, numbers or text' });
    }
    
    try {
        const sock = sessions.get(sessionId);
        if (!sock) {
            return res.status(404).json({ error: 'Session not found' });
        }
        
        const results = [];
        for (const number of numbers) {
            const jid = number.includes('@s.whatsapp.net') ? number : `${number}@s.whatsapp.net`;
            try {
                await sock.sendMessage(jid, { text });
                results.push({ number, success: true });
            } catch (err) {
                results.push({ number, success: false, error: err.message });
            }
        }
        
        res.json({ results });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get all contacts (for testing)
app.get('/contacts/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    
    try {
        const sock = sessions.get(sessionId);
        if (!sock) {
            return res.status(404).json({ error: 'Session not found' });
        }
        
        const contacts = sock.store?.contacts || {};
        res.json({ contacts });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete session (logout)
app.delete('/session/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    
    try {
        const sock = sessions.get(sessionId);
        if (sock) {
            await sock.logout();
            sessions.delete(sessionId);
            
            // Remove auth files
            const authDir = path.join(AUTH_DIR, sessionId);
            if (fs.existsSync(authDir)) {
                fs.rmSync(authDir, { recursive: true, force: true });
            }
        }
        
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// List all sessions
app.get('/sessions', (req, res) => {
    const sessionList = [];
    for (const [id, sock] of sessions) {
        sessionList.push({
            id,
            connected: sock.ws.readyState === 1,
        });
    }
    res.json({ sessions: sessionList });
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
    console.log(`Baileys WhatsApp API running on port ${PORT}`);
    console.log(`API Docs:`);
    console.log(`  POST /session/:sessionId - Start session (generates QR)`);
    console.log(`  GET  /qr/:sessionId     - Get QR code as image`);
    console.log(`  POST /send              - Send message {sessionId, jid, text}`);
    console.log(`  POST /broadcast         - Broadcast {sessionId, numbers[], text}`);
    console.log(`  GET  /contacts/:sessionId - Get contacts`);
    console.log(`  DELETE /session/:sessionId - Logout and delete session`);
    console.log(`  GET  /sessions          - List all sessions`);
    console.log(`  GET  /health            - Health check`);
});
