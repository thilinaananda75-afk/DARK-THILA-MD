'use strict';

// ═══════════════════════════════════════════════════════════════
//  DARK THILA WHATSAPP BOT  — server/index.js
//  Pure JS • No build step • Works on Koyeb free tier
// ═══════════════════════════════════════════════════════════════

const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const qrcode   = require('qrcode');
const axios    = require('axios');
const yts      = require('yt-search');
const ytdl     = require('@distube/ytdl-core');
const ffmpeg   = require('fluent-ffmpeg');
const pino     = require('pino');

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
} = require('@whiskeysockets/baileys');

// ── Config ────────────────────────────────────────────────────
const PORT      = process.env.PORT || 8000;
const AUTH_DIR  = path.join(__dirname, '..', 'session');
const BOT_NAME  = 'DARK THILA';
const BOT_LOGO  = 'https://files.catbox.moe/fi38yw.jpg';
const logger    = pino({ level: 'silent' });

if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

// ── State ─────────────────────────────────────────────────────
let sock         = null;
let qrDataUrl    = null;
let connected    = false;
let pairCode     = null;   // latest generated pairing code
let pairResolve  = null;   // promise resolver waiting for code

// ═══════════════════════════════════════════════════════════════
//  EXPRESS — starts FIRST so Koyeb health check always passes
// ═══════════════════════════════════════════════════════════════
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Health check
app.get('/healthz', (_, res) => res.status(200).send('OK'));

// Status API
app.get('/api/status', (_, res) => {
  res.json({ connected, hasQr: !!qrDataUrl, pairCode });
});

// QR image API
app.get('/api/qr', (_, res) => {
  if (!qrDataUrl) return res.json({ qr: null });
  res.json({ qr: qrDataUrl });
});

// ── PAIRING CODE API ──────────────────────────────────────────
// This is the 100% correct Baileys pairing flow:
// 1. Destroy old socket
// 2. Create fresh socket (no auth so WA sends QR challenge)
// 3. Intercept the QR event → call requestPairingCode() immediately
// 4. Return the 8-digit code to the browser
app.post('/api/pair', async (req, res) => {
  const { phone } = req.body;
  const num = String(phone || '').replace(/\D/g, '');

  if (!num || num.length < 7) {
    return res.status(400).json({ error: 'Phone number invalid. Use country code, e.g. 94771234567' });
  }
  if (connected) {
    return res.status(400).json({ error: 'Bot is already connected!' });
  }

  try {
    const code = await startPairingSocket(num);
    pairCode = code;
    return res.json({ code });
  } catch (e) {
    console.error('Pair error:', e.message);
    return res.status(500).json({ error: e.message });
  }
});

// ── WEB UI ────────────────────────────────────────────────────
app.get('/', (_, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 ${BOT_NAME} web UI → http://0.0.0.0:${PORT}`);
});

// ═══════════════════════════════════════════════════════════════
//  PAIRING SOCKET — fresh socket just to get the code
// ═══════════════════════════════════════════════════════════════
async function startPairingSocket(phone) {
  // Kill existing socket if any
  if (sock) {
    try { sock.end(); } catch {}
    sock = null;
  }
  // Clear session so WA issues a fresh QR challenge
  if (fs.existsSync(AUTH_DIR)) {
    fs.rmSync(AUTH_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Timed out (30s). Check your number and try again.'));
    }, 30000);

    const pairSock = makeWASocket({
      version,
      auth: state,
      logger,
      browser: Browsers.ubuntu('Chrome'),
      printQRInTerminal: false,
    });

    pairSock.ev.on('creds.update', saveCreds);

    pairSock.ev.on('connection.update', async ({ qr, connection }) => {
      // ✅ THE ONLY CORRECT WAY: call requestPairingCode inside the qr event
      if (qr) {
        // Also show QR as fallback
        try { qrDataUrl = await qrcode.toDataURL(qr); } catch {}

        try {
          const code = await pairSock.requestPairingCode(phone);
          clearTimeout(timer);

          // Destroy pairing socket, start main bot
          setTimeout(() => {
            try { pairSock.end(); } catch {}
            startMainBot();
          }, 800);

          resolve(code);
        } catch (err) {
          clearTimeout(timer);
          try { pairSock.end(); } catch {}
          reject(new Error('requestPairingCode failed: ' + err.message));
        }
      }

      if (connection === 'open') {
        // Already authenticated (session restored)
        clearTimeout(timer);
        connected = true;
        qrDataUrl = null;
        sock = pairSock;
        attachHandlers(pairSock);
        resolve('ALREADY_CONNECTED');
      }
    });
  });
}

// ═══════════════════════════════════════════════════════════════
//  MAIN BOT SOCKET — QR mode, used after pairing or on restart
// ═══════════════════════════════════════════════════════════════
async function startMainBot() {
  if (sock) {
    try { sock.end(); } catch {}
    sock = null;
  }

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger,
    browser: Browsers.ubuntu('Chrome'),
    printQRInTerminal: true,
    connectTimeoutMs: 60000,
    keepAliveIntervalMs: 25000,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      try { qrDataUrl = await qrcode.toDataURL(qr); } catch {}
      console.log('📱 QR ready — visit web UI to scan');
    }

    if (connection === 'close') {
      connected = false;
      qrDataUrl = null;
      const code = lastDisconnect?.error?.output?.statusCode;
      console.log('❌ Disconnected. Code:', code);
      if (code === DisconnectReason.loggedOut) {
        console.log('🚪 Logged out — clearing session');
        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        fs.mkdirSync(AUTH_DIR, { recursive: true });
      }
      setTimeout(startMainBot, 5000);
    }

    if (connection === 'open') {
      connected = true;
      qrDataUrl = null;
      pairCode  = null;
      console.log(`✅ ${BOT_NAME} connected!`);

      // Self-notify
      try {
        const botJid = sock.user?.id?.replace(/:\d+/, '') + '@s.whatsapp.net';
        await sock.sendMessage(botJid, {
          image: { url: BOT_LOGO },
          caption: `${BOT_NAME} CONNECTED SUCCESSFULLY ✅`,
        });
      } catch (e) {
        console.error('Self-notify error:', e.message);
      }
    }
  });

  attachHandlers(sock);
}

// ═══════════════════════════════════════════════════════════════
//  MESSAGE HANDLER
// ═══════════════════════════════════════════════════════════════
function attachHandlers(socket) {
  socket.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;

      const jid  = msg.key.remoteJid;
      const text = (
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        ''
      ).trim();

      if (!text.startsWith('.')) continue;

      const [cmd, ...args] = text.split(' ');
      const arg = args.join(' ').trim();

      console.log(`📨 ${cmd} | ${jid}`);

      try {
        if (cmd === '.menu')               await sendMenu(socket, jid, msg);
        else if (cmd === '.song' && arg)   await downloadSong(socket, jid, msg, arg);
        else if (cmd === '.tiktok' && arg) await downloadVideo(socket, jid, msg, arg, 'tiktok');
        else if (cmd === '.fb' && arg)     await downloadVideo(socket, jid, msg, arg, 'fb');
        else {
          await socket.sendMessage(jid, {
            text: `❓ Unknown command.\nType *.menu* to see all commands.`,
          }, { quoted: msg });
        }
      } catch (e) {
        console.error('Handler error:', e.message);
        await socket.sendMessage(jid, { text: `⚠️ Error: ${e.message}` }, { quoted: msg });
      }
    }
  });
}

// ═══════════════════════════════════════════════════════════════
//  COMMANDS
// ═══════════════════════════════════════════════════════════════
async function sendMenu(socket, jid, msg) {
  await socket.sendMessage(jid, {
    text:
      `╔══════════════════════════╗\n` +
      `║  🌑 *${BOT_NAME} BOT* 🌑  ║\n` +
      `╠══════════════════════════╣\n` +
      `║                          ║\n` +
      `║  🎵 *.song [name]*       ║\n` +
      `║  Search & download song  ║\n` +
      `║                          ║\n` +
      `║  📱 *.tiktok [link]*     ║\n` +
      `║  Download TikTok video   ║\n` +
      `║                          ║\n` +
      `║  📘 *.fb [link]*         ║\n` +
      `║  Download FB video       ║\n` +
      `║                          ║\n` +
      `║  📋 *.menu*              ║\n` +
      `║  Show this menu          ║\n` +
      `║                          ║\n` +
      `╚══════════════════════════╝`,
  }, { quoted: msg });
}

async function downloadSong(socket, jid, msg, query) {
  await socket.sendMessage(jid, { text: `🔍 Searching *${query}*...` }, { quoted: msg });

  const results = await yts(query);
  const video   = results.videos[0];
  if (!video) return socket.sendMessage(jid, { text: '❌ Not found.' }, { quoted: msg });

  await socket.sendMessage(jid, {
    image: { url: video.thumbnail },
    caption:
      `🎵 *${video.title}*\n` +
      `👤 *Artist:* ${video.author.name}\n` +
      `⏱️ *Duration:* ${video.timestamp}\n` +
      `👁️ *Views:* ${Number(video.views).toLocaleString()}\n\n` +
      `_Downloading audio..._`,
  }, { quoted: msg });

  const tmp = `/tmp/song_${Date.now()}.mp3`;

  await new Promise((resolve, reject) => {
    const stream = ytdl(video.url, { filter: 'audioonly', quality: 'highestaudio' });
    ffmpeg(stream)
      .audioBitrate(128)
      .save(tmp)
      .on('end', resolve)
      .on('error', reject);
  });

  await socket.sendMessage(jid, {
    audio: { url: tmp },
    mimetype: 'audio/mpeg',
    ptt: false,
  }, { quoted: msg });

  fs.unlink(tmp, () => {});
}

async function downloadVideo(socket, jid, msg, link, platform) {
  await socket.sendMessage(jid, { text: `⬇️ Downloading *${platform}* video...` }, { quoted: msg });

  const tmp = `/tmp/vid_${Date.now()}.mp4`;
  let videoUrl;

  if (platform === 'tiktok') {
    const { data } = await axios.get(`https://tikwm.com/api/?url=${encodeURIComponent(link)}`, { timeout: 30000 });
    videoUrl = data?.data?.play || data?.data?.hdplay;
    if (!videoUrl) throw new Error('Could not get TikTok video URL');
  } else {
    const { data } = await axios.get(`https://api.tiklydown.eu.org/api/download/fb?url=${encodeURIComponent(link)}`, { timeout: 30000 });
    videoUrl = data?.data?.hd || data?.data?.sd;
    if (!videoUrl) throw new Error('Could not get Facebook video URL — make sure the video is public');
  }

  const response = await axios({ url: videoUrl, method: 'GET', responseType: 'stream', timeout: 60000 });
  await new Promise((resolve, reject) => {
    const w = fs.createWriteStream(tmp);
    response.data.pipe(w);
    w.on('finish', resolve);
    w.on('error', reject);
  });

  await socket.sendMessage(jid, {
    video: { url: tmp },
    caption: `✅ Downloaded by *${BOT_NAME}*`,
    mimetype: 'video/mp4',
  }, { quoted: msg });

  fs.unlink(tmp, () => {});
}

// ═══════════════════════════════════════════════════════════════
//  CRASH GUARD
// ═══════════════════════════════════════════════════════════════
process.on('uncaughtException',  e => console.error('uncaughtException:', e.message));
process.on('unhandledRejection', e => console.error('unhandledRejection:', e));

// ── Start ─────────────────────────────────────────────────────
startMainBot().catch(e => {
  console.error('startMainBot failed:', e.message);
  setTimeout(startMainBot, 10000);
});
