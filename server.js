const express    = require('express');
const session    = require('express-session');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const path       = require('path');
require('dotenv').config();

const app  = express();
const PORT = process.env.PORT || 3000;

// Render behind reverse proxy fix for session cookies
app.set('trust proxy', 1);

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'fast-mailer-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production', // Production me secure SSL cookies
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

// API Route: Directly sends mail to Client's Email ID
app.post('/api/send-email', requireLogin, async (req, res) => {
  const { senderName, gmailId, appPassword, subject, messageBody, to, clientEmail, recipient } = req.body;
  
  // Client ID fallback check (accepts 'to', 'clientEmail', or 'recipient')
  const clientTargetEmail = to || clientEmail || recipient;

  if (!gmailId || !appPassword || !clientTargetEmail) {
    return res.status(400).json({ success: false, message: 'Missing required email fields (Gmail ID, App Password, or Client Email)' });
  }

  // Basic email sanitization
  const cleanTo = clientTargetEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanTo)) {
    return res.status(400).json({ success: false, message: 'Invalid client recipient email address' });
  }

  try {
    const transporter = getTransporter(gmailId, appPassword);

    // Send email directly to client ID while maintaining original SMTP flow
    await transporter.sendMail({
      from: senderName ? `"${senderName}" <${gmailId}>` : `"${gmailId}" <${gmailId}>`,
      replyTo: senderName ? `"${senderName}" <${gmailId}>` : gmailId,
      to: cleanTo, // Client's email address
      subject: subject,
      text: messageBody
    });

    res.json({ success: true, message: `Email sent successfully to ${cleanTo}` });
  } catch (err) {
    console.error(`❌ ${cleanTo}:`, err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Fast Mailer running on port ${PORT}`));
