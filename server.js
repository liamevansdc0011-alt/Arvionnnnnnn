const express = require('express');
const session = require('express-session');
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Body Parsers (express built-in, deprecated body-parser ki zaroorat nahi)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Secure Session Configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'fast-mailer-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true, // XSS attacks se bachata hai
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 8 // 8 hours
  }
}));

app.use(express.static(path.join(__dirname, 'public')));

// 1. Anti-Spam & Security: Login Rate Limiter (Brute-force se bachane ke liye)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Maximum 10 attempts
  message: { success: false, message: 'Bohat saare login attempts. Thodi der baad try karein.' }
});

// 2. Anti-Spam: Email Rate Limiter (Gmail IP block / Spam flagging se bachne ke liye)
const mailLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // Per minute limit to keep sending human-like
  message: { success: false, message: 'Email rate limit exceeded. Please wait a minute.' }
});

// Auth Guard Middleware
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

// Login Route (Aapke original credentials fallback ke sath)
app.post('/login', loginLimiter, (req, res) => {
  const { username, password } = req.body;
  const validUser = process.env.ADMIN_USER || '@#@#@';
  const validPass = process.env.ADMIN_PASS || '@#@#@';

  if (username === validUser && password === validPass) {
    req.session.loggedIn = true;
    return res.json({ success: true, message: 'Login successful' });
  }

  return res.status(401).json({ success: false, message: 'Invalid username or password' });
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// Helper: Email Format Validator
const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

// Safe & Anti-Spam Email Route
app.post('/api/send-email', requireLogin, mailLimiter, async (req, res) => {
  const { senderName, gmailId, appPassword, subject, messageBody, to } = req.body;

  // Validation
  if (!gmailId || !appPassword || !to || !messageBody) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  if (!isValidEmail(to) || !isValidEmail(gmailId)) {
    return res.status(400).json({ success: false, message: 'Invalid email address format' });
  }

  // Transporter
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: gmailId, pass: appPassword }
  });

  try {
    // Clean Sender Header (Spam filter trigger hone se rokte hain)
    const cleanSender = senderName ? senderName.replace(/"/g, '') : '';
    const fromHeader = cleanSender ? `"${cleanSender}" <${gmailId}>` : gmailId;

    await transporter.sendMail({
      from: fromHeader,
      to: to.trim(),
      subject: subject || '(No Subject)',
      text: messageBody
    });

    res.json({ success: true, message: 'Email sent successfully' });
  } catch (err) {
    console.error(`❌ Email Send Failed [${to}]:`, err.message);
    res.status(500).json({ success: false, message: 'Failed to send email. Check credentials.' });
  }
});

app.listen(PORT, () => console.log(`🚀 Fast Mailer safely running on port ${PORT}`));
