const express = require('express');
const session = require('express-session');
const nodemailer = require('nodemailer');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Express built-in body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'fast-mailer-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 1000 * 60 * 60 * 8 }
}));

app.use(express.static(path.join(__dirname, 'public')));

// Authentication Middleware
function requireLogin(req, res, next) {
  if (req.session?.loggedIn) return next();
  res.redirect('/');
}

// Routes
app.get('/', (req, res) => {
  if (req.session?.loggedIn) return res.redirect('/launcher');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/launcher', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'launcher.html'));
});

// Exact Login Logic (Fallback Same As Original Code)
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const validUser = process.env.ADMIN_USER || '@#@#@';
  const validPass = process.env.ADMIN_PASS || '@#@#@';

  if (username === validUser && password === validPass) {
    req.session.loggedIn = true;
    return res.json({ success: true });
  }
  res.json({ success: false, message: 'Invalid username or password' });
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// Transporter Cache for Speed Optimization
const transporterCache = new Map();

function getTransporter(gmailId, appPassword) {
  const cacheKey = `${gmailId}:${appPassword}`;
  
  if (!transporterCache.has(cacheKey)) {
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      pool: true, // Connection Pooling for High Speed
      maxConnections: 5,
      maxMessages: 100,
      auth: {
        user: gmailId,
        pass: appPassword
      }
    });
    transporterCache.set(cacheKey, transporter);
  }
  
  return transporterCache.get(cacheKey);
}

// Unique Ref/ID Code Generator
function generateUniqueCode() {
  const randomHex = crypto.randomBytes(4).toString('hex').toUpperCase();
  const timeSuffix = Date.now().toString().slice(-4);
  return `ID-${randomHex}-${timeSuffix}`;
}

// Mail Send API
app.post('/api/send-email', requireLogin, async (req, res) => {
  const { senderName, gmailId, appPassword, subject, messageBody, to } = req.body;

  if (!gmailId || !appPassword || !to) {
    return res.status(400).json({ success: false, message: 'Missing fields' });
  }

  try {
    const transporter = getTransporter(gmailId, appPassword);
    const uniqueId = generateUniqueCode();

    // Template ke neeche unique ID append karna (Inbox delivery me help karta hai)
    const finalMessageBody = `${messageBody ? messageBody.trim() : ''}\n\n---\nRef Code: [${uniqueId}]`;

    const mailOptions = {
      from: senderName ? `"${senderName}" <${gmailId}>` : `"${gmailId}" <${gmailId}>`,
      to: to.trim(),
      subject: subject,
      text: finalMessageBody,
      headers: {
        'X-Mailer': 'Microsoft Outlook 16.0',
        'X-Priority': '3 (Normal)',
        'Message-ID': `<${Date.now()}.${uniqueId}@gmail.com>`
      }
    };

    await transporter.sendMail(mailOptions);
    res.json({ success: true, refCode: uniqueId });
  } catch (err) {
    console.error(`❌ ${to}:`, err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.listen(PORT, () => console.log(`🚀 Fast Mailer on port ${PORT}`));
