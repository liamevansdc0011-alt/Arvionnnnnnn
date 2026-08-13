const express    = require('express');
const session    = require('express-session');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const path       = require('path');
require('dotenv').config();

const app  = express();
const PORT = process.env.PORT || 3000;

// Trust proxy for Render environment
app.set('trust proxy', 1);

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'fast-mailer-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 8
  }
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
  const validUser = process.env.ADMIN_USER || 'gggg';
  const validPass = process.env.ADMIN_PASS || 'gggg';
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

  // Optimized SMTP pool for human-like steady delivery
  const instance = nodemailer.createTransport({
    pool: true,
    host: 'smtp.gmail.com',
    port: 465,
    secure: true, // SSL/TLS
    auth: {
      user: gmailId,
      pass: appPassword
    },
    maxConnections: 1,      // Single connection to avoid aggressive Gmail spam triggers
    maxMessages: 100,
    rateLimit: true,
    rateDelta: 1100,         // 1.1 Seconds rate limit window
    rateLimitNum: 1          // Strictly 1 mail per 1.1 seconds
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

// Helper function for 1.1-second delay
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper to convert raw text into clean HTML paragraphs
function formatToHTML(text) {
  if (!text) return '';
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped.split('\n').map(line => line.trim() ? `<p style="margin: 0 0 10px 0; font-family: Arial, sans-serif; font-size: 14px; line-height: 1.5; color: #333333;">${line}</p>` : '<br/>').join('');
}

// Send Mail Route
app.post('/api/send-email', requireLogin, async (req, res) => {
  const { senderName, gmailId, appPassword, subject, messageBody, to, clientEmail, recipient } = req.body;
  const clientTargetEmail = to || clientEmail || recipient;

  if (!gmailId || !appPassword || !clientTargetEmail) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  // Basic email sanitization
  const cleanTo = clientTargetEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanTo)) {
    return res.status(400).json({ success: false, message: 'Invalid recipient email' });
  }

  try {
    const transporter = getTransporter(gmailId, appPassword);

    // Exact 1.1 Second delay execution before sending
    await sleep(1100);

    const fromAddress = senderName 
      ? `"${senderName.replace(/"/g, '')}" <${gmailId}>` 
      : `"${gmailId}" <${gmailId}>`;

    const htmlBody = formatToHTML(messageBody);

    // Send Mail with Anti-Spam Headers & Dual Format (HTML + Plain Text)
    await transporter.sendMail({
      from: fromAddress,
      replyTo: fromAddress,
      to: cleanTo,
      subject: subject || '',
      text: messageBody,        // Plain text fallback
      html: htmlBody,           // HTML format (prevents spam flagging)
      headers: {
        'X-Mailer': 'GmailApp-Mailer',
        'X-Priority': '3 (Normal)',
        'Message-ID': `<${Date.now()}.${Math.random().toString(36).substring(2, 9)}@gmail.com>`
      }
    });

    res.json({ success: true, message: `Email sent to ${cleanTo} with 1.1s speed control.` });
  } catch (err) {
    console.error(`❌ ${cleanTo}:`, err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Fast Mailer running on port ${PORT}`));
