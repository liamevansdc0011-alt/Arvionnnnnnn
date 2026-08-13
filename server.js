const express = require('express');
const session = require('express-session');
const nodemailer = require('nodemailer');
const path = require('path');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Render reverse proxy ke pechhe chalta hai, isliye trust proxy enable karna zaruri hai
app.set('trust proxy', 1);

// Modern Express Built-in Parsers (body-parser ki zarurat nahi)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Secure Session Setup
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-this-secret-in-env',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production', // Render par HTTPS enable rahega
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 8 // 8 hours
  }
}));

app.use(express.static(path.join(__dirname, 'public')));

// --- SPAM & BRUTE FORCE PROTECTION (RATE LIMITERS) ---

// Login Protection: 15 minute me max 5 attempts
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { success: false, message: 'Too many login attempts. Please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Email Spam Protection: 15 minute me max 20 emails per IP
const emailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, message: 'Rate limit exceeded. Please wait before sending more emails.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// --- HELPER FUNCTIONS & MIDDLEWARE ---

function requireLogin(req, res, next) {
  if (req.session?.loggedIn) return next();
  res.status(401).redirect('/');
}

// Basic Email Validation Helper
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// --- ROUTES ---

app.get('/', (req, res) => {
  if (req.session?.loggedIn) return res.redirect('/launcher');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/launcher', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'launcher.html'));
});

app.post('/login', loginLimiter, (req, res) => {
  const { username, password } = req.body;
  const validUser = process.env.ADMIN_USER;
  const validPass = process.env.ADMIN_PASS;

  if (!validUser || !validPass) {
    console.error('⚠️ ADMIN_USER or ADMIN_PASS environment variables are missing!');
    return res.status(500).json({ success: false, message: 'Server authentication configuration error.' });
  }

  if (username === validUser && password === validPass) {
    req.session.loggedIn = true;
    return res.json({ success: true });
  }

  res.status(401).json({ success: false, message: 'Invalid username or password' });
});

app.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ success: false, message: 'Logout failed' });
    res.clearCookie('connect.sid');
    res.json({ success: true });
  });
});

app.post('/api/send-email', requireLogin, emailLimiter, async (req, res) => {
  const { senderName, gmailId, appPassword, subject, messageBody, to } = req.body;

  // Validation Check
  if (!gmailId || !appPassword || !to || !subject || !messageBody) {
    return res.status(400).json({ success: false, message: 'All fields are required.' });
  }

  if (!isValidEmail(gmailId) || !isValidEmail(to)) {
    return res.status(400).json({ success: false, message: 'Invalid email address format.' });
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
    res.json({ success: true, message: 'Email sent successfully!' });
  } catch (err) {
    console.error(`❌ Mail send error [${to}]:`, err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
