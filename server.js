const express = require('express');
const session = require('express-session');
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Render / Cloud Hosting Reverse Proxy Setup (Session cookies ke liye zaroori)
app.set('trust proxy', 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'fast-mailer-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 8 // 8 hours
  }
}));

app.use(express.static(path.join(__dirname, 'public')));

// Rate Limiter: Spam-like behavior se bachne ke liye
const mailLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // Per minute sending limit to avoid Gmail IP blocks
  message: { success: false, message: 'Too many requests. Please wait a minute.' }
});

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

// Helper for validating email format
const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

app.post('/api/send-email', requireLogin, mailLimiter, async (req, res) => {
  const { senderName, gmailId, appPassword, subject, messageBody, to } = req.body;

  if (!gmailId || !appPassword || !to || !messageBody) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  if (!isValidEmail(to) || !isValidEmail(gmailId)) {
    return res.status(400).json({ success: false, message: 'Invalid email address' });
  }

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true, // SSL connection
    auth: {
      user: gmailId.trim(),
      pass: appPassword.trim()
    }
  });

  try {
    // 1. Clean Sender Header Alignment (Gmail strict alignment check)
    const cleanSenderName = senderName ? senderName.replace(/[^\w\s]/gi, '') : '';
    const formattedFrom = cleanSenderName 
      ? `"${cleanSenderName}" <${gmailId.trim()}>` 
      : gmailId.trim();

    // 2. Custom Unique Message-ID (Spam filters treat missing/malformed IDs suspiciously)
    const domain = gmailId.split('@')[1] || 'gmail.com';
    const customMessageId = `<${Date.now()}.${Math.random().toString(36).substring(2, 9)}@${domain}>`;

    await transporter.sendMail({
      from: formattedFrom,
      to: to.trim(),
      subject: subject || '(No Subject)',
      text: messageBody,
      messageId: customMessageId,
      headers: {
        'X-Mailer': 'Node.js Direct Mailer',
        'X-Priority': '3', // Normal priority (Avoid High Priority flag as spam filters flag it)
        'Importance': 'Normal'
      }
    });

    res.json({ success: true, message: 'Email sent successfully to inbox!' });
  } catch (err) {
    console.error(`❌ Mail delivery error for ${to}:`, err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.listen(PORT, () => console.log(`🚀 Fast Mailer running on port ${PORT}`));
