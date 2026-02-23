# 🌑 DARK THILA WhatsApp Bot

## 📁 Project Structure
```
darkthila/
├── server/
│   └── index.js       ← Bot + Express server
├── public/
│   └── index.html     ← Web UI
├── package.json
├── Dockerfile
└── .gitignore
```

## 🚀 Deploy to Koyeb (Free)

### Step 1 — Push to GitHub
```bash
git init
git add .
git commit -m "DARK THILA Bot v2"
git remote add origin https://github.com/YOUR_USERNAME/dark-thila-bot.git
git push -u origin main
```

### Step 2 — Koyeb Setup
1. Go to https://app.koyeb.com → **Create Service**
2. Select **GitHub** → choose your repo
3. Builder: **Dockerfile** (auto-detected)
4. Port: **8000**
5. Click **Deploy**

### Step 3 — Connect WhatsApp
1. Open your Koyeb URL in browser
2. Enter your phone number (with country code, no + or spaces)
   - 🇱🇰 Sri Lanka: `94771234567`
   - 🇮🇳 India: `911234567890`
3. Click **PAIR** → wait ~10 seconds
4. An 8-digit code appears
5. WhatsApp → Settings → Linked Devices → Link a Device → **Link with phone number**
6. Enter the code ✅

## 💬 Commands
| Command | Description |
|---------|-------------|
| `.menu` | Show command list |
| `.song [name]` | Search & download song |
| `.tiktok [link]` | Download TikTok video |
| `.fb [link]` | Download Facebook video |
