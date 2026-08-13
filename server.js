const express = require('express');
const session = require('express-session');
const nodemailer = require('nodemailer');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Modern Express built-in body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session Configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'fast-mailer-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production', 
    maxAge: 1000 * 60 * 60 * 8 // 8 Hours
  }
}));

app.use(express.static(path.join(__dirname, 'public')));

// Authentication Middleware
function requireLogin(req, res, next) {
  if (req.session?.loggedIn) return next();
  return res.redirect('/');
}

// Page Routes
app.get('/', (req, res) => {
  if (req.session?.loggedIn) return res.redirect('/launcher');
  return res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/launcher', requireLogin, (req, res) => {
  return res.sendFile(path.join(__dirname, 'public', 'launcher.html'));
});

// Login Handler (Aapke original credentials intact hain)
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const validUser = process.env.ADMIN_USER || '@#@#@';
  const validPass = process.env.ADMIN_PASS || '@#@#@';

  if (username === validUser && password === validPass) {
    req.session.loggedIn = true;
    return res.json({ success: true });
  }
  return res.status(401).json({ success: false, message: 'Invalid username or password' });
});

// Logout Handler
app.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// Email Sending API
app.post('/api/send-email', requireLogin, async (req, res) => {
  const { senderName, gmailId, appPassword, subject, messageBody, to } = req.body;

  // Basic Input Validation
  if (!gmailId || !appPassword || !to || !subject || !messageBody) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: gmailId, pass: appPassword }
  });

  try {
    await transporter.sendMail({
      from: senderName ? `"${senderName}" <${gmailId}>` : gmailId,
      to,
      subject,
      text: messageBody
    });

    return res.json({ success: true, message: 'Email process completed' });
  } catch (err) {
    console.error(`❌ Mail delivery error for [${to}]:`, err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

app.listen(PORT, () => console.log(`🚀 Fast Mailer running on port ${PORT}`));
