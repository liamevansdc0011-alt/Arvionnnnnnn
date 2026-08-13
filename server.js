const express = require('express');
const session = require('express-session');
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Body Parsers (Form submission aur JSON dono support karne ke liye)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session Setup
app.use(session({
  secret: process.env.SESSION_SECRET || 'fast-mailer-default-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false, // Local testing ke liye false, HTTPS production me true karein
    maxAge: 1000 * 60 * 60 * 8 // 8 hours
  }
}));

app.use(express.static(path.join(__dirname, 'public')));

// Rate Limiters
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'Too many attempts. Try again later.' }
});

const mailLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { success: false, message: 'Rate limit exceeded. Please wait.' }
});

// Middleware
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

// Fixed Login Route with Hardcoded Fallback Credentials
app.post('/login', loginLimiter, (req, res) => {
  const { username, password } = req.body;

  // Pehle .env se check karega, agar nahi milega toh fallback values ('HHHH' / 'HHHH') use karega
  const validUser = process.env.ADMIN_USER || 'HHHH';
  const validPass = process.env.ADMIN_PASS || 'HHHH';

  if (username === validUser && password === validPass) {
    req.session.loggedIn = true;
    return res.json({ success: true, message: 'Login successful' });
  }

  return res.status(401).json({ success: false, message: 'Invalid username or password' });
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// Helper Function
const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

// Email Route
app.post('/api/send-email', requireLogin, mailLimiter, async (req, res) => {
  const { senderName, gmailId, appPassword, subject, messageBody, to } = req.body;

  const mailUser = gmailId || process.env.GMAIL_USER;
  const mailPass = appPassword || process.env.GMAIL_APP_PASS;

  if (!mailUser || !mailPass || !to || !messageBody) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  if (!isValidEmail(to) || !isValidEmail(mailUser)) {
    return res.status(400).json({ success: false, message: 'Invalid email address format' });
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: mailUser, pass: mailPass }
  });

  try {
    const fromHeader = senderName ? `"${senderName.replace(/"/g, '')}" <${mailUser}>` : mailUser;

    await transporter.sendMail({
      from: fromHeader,
      to,
      subject: subject || '(No Subject)',
      text: messageBody
    });

    res.json({ success: true, message: 'Email sent successfully!' });
  } catch (err) {
    console.error(`❌ Mail error [${to}]:`, err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.listen(PORT, () => console.log(`🚀 Fast Mailer running on http://localhost:${PORT}`));
