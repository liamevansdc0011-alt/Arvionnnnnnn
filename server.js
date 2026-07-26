const express    = require('express');
const session    = require('express-session');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const path       = require('path');
require('dotenv').config();

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'fast-mailer-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 1000 * 60 * 60 * 8 }
}));
app.use(express.static(path.join(__dirname, 'public')));

function requireLogin(req, res, next) {
  if (req.session?.loggedIn) return next();
  res.redirect('/');
}

app.get('/', (req, res) => {
  if (req.session?.loggedIn) return res.redirect('/launcher');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/launcher', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'launcher.html'));
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const validUser = process.env.ADMIN_USER || '!!';
  const validPass = process.env.ADMIN_PASS || '!!';
  if (username === validUser && password === validPass) {
    req.session.loggedIn = true;
    return res.json({ success: true });
  }
  res.json({ success: false, message: 'Invalid username or password' });
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// Transporters store to reuse open SMTP pool sessions
const transporters = new Map();

// Helper to get or create a secure transporter for Gmail
function getTransporter(gmailId, appPassword) {
  const key = `${gmailId}_${appPassword}`;
  if (transporters.has(key)) {
    const cached = transporters.get(key);
    cached.lastUsed = Date.now();
    return cached.instance;
  }

  // Create transporter optimized for clean 1-by-1 delivery
  const instance = nodemailer.createTransport({
    pool: true,
    host: 'smtp.gmail.com',
    port: 465,
    secure: true, // SSL/TLS
    auth: {
      user: gmailId,
      pass: appPassword
    },
    maxConnections: 3,
    maxMessages: 200,
    rateLimit: true,
    rateDelta: 1000,
    rateLimitNum: 2
  });

  transporters.set(key, {
    instance,
    lastUsed: Date.now()
  });

  return instance;
}

// Clean up idle transporters every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, cached] of transporters.entries()) {
    if (now - cached.lastUsed > 10 * 60 * 1000) {
      cached.instance.close();
      transporters.delete(key);
    }
  }
}, 5 * 60 * 1000);

app.post('/api/send-email', requireLogin, async (req, res) => {
  const { senderName, gmailId, appPassword, subject, messageBody, to } = req.body;
  if (!gmailId || !appPassword || !to)
    return res.status(400).json({ success: false, message: 'Missing fields' });

  const cleanTo = to.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanTo)) {
    return res.status(400).json({ success: false, message: 'Invalid recipient email' });
  }

  try {
    const transporter = getTransporter(gmailId, appPassword);

    await transporter.sendMail({
      from: senderName ? `"${senderName}" <${gmailId}>` : `"${gmailId}" <${gmailId}>`,
      to: cleanTo,
      subject: subject,
      text: messageBody,
      headers: {
        'X-Priority': '3',
        'X-MSMail-Priority': 'Normal',
        'Importance': 'normal',
        'Message-ID': `<${Date.now()}.${Math.random().toString(36).substring(2, 15)}@gmail.com>`,
        'MIME-Version': '1.0'
      }
    });

    res.json({ success: true });
  } catch (err) {
    console.error(`❌ ${cleanTo}:`, err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.listen(PORT, () => console.log(`🚀 Fast Mailer on port ${PORT}`));
