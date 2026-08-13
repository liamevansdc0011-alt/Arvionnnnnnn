const express = require('express');
const session = require('express-session');
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 1. Session Security
app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback-secure-random-string-change-this',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true, // Prevents XSS script access to session cookie
    secure: process.env.NODE_ENV === 'production', // Use HTTPS in production
    maxAge: 1000 * 60 * 60 * 8 // 8 hours
  }
}));

app.use(express.static(path.join(__dirname, 'public')));

// 2. Anti-Spam / Rate Limiting (Prevent Brute-Force & Abuse)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Max 5 login attempts per IP
  message: { success: false, message: 'Too many login attempts. Try again later.' }
});

const mailLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // Max 10 emails per minute to prevent Gmail rate-limit ban
  message: { success: false, message: 'Rate limit exceeded. Slow down sending emails.' }
});

// Middleware for Login Check
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

// Secure Login Route
app.post('/login', loginLimiter, (req, res) => {
  const { username, password } = req.body;
  const adminUser = process.env.ADMIN_USER;
  const adminPass = process.env.ADMIN_PASS;

  if (!adminUser || !adminPass) {
    return res.status(500).json({ success: false, message: 'Server configuration error.' });
  }

  if (username === adminUser && password === adminPass) {
    req.session.loggedIn = true;
    return res.json({ success: true });
  }

  res.status(401).json({ success: false, message: 'Invalid radhe or kkkk' });
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// Helper: Basic Email Validator
const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

// Secure Email Sending Endpoint
app.post('/api/send-email', requireLogin, mailLimiter, async (req, res) => {
  const { senderName, gmailId, appPassword, subject, messageBody, to } = req.body;

  // Use body credentials OR fallback to server .env credentials
  const mailUser = gmailId || process.env.GMAIL_USER;
  const mailPass = appPassword || process.env.GMAIL_APP_PASS;

  if (!mailUser || !mailPass || !to || !messageBody) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  if (!isValidEmail(to) || !isValidEmail(mailUser)) {
    return res.status(400).json({ success: false, message: 'Invalid email address format' });
  }

  // Reusable Transporter
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: mailUser, pass: mailPass }
  });

  try {
    const fromHeader = senderName 
      ? `"${senderName.replace(/"/g, '')}" <${mailUser}>` 
      : mailUser;

    await transporter.sendMail({
      from: fromHeader,
      to,
      subject: subject || '(No Subject)',
      text: messageBody
    });

    res.json({ success: true });
  } catch (err) {
    console.error(`❌ Email send failed [${to}]:`, err.message);
    res.status(500).json({ success: false, message: 'Failed to send email. Check credentials or receiver address.' });
  }
});

app.listen(PORT, () => console.log(`🚀 Fast Mailer running safely on port ${PORT}`));
