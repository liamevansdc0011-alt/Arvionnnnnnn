const express   = require('express');
const session   = require('express-session');
const nodemailer = require('nodemailer');
const path      = require('path');
require('dotenv').config();

const app  = express();
const PORT = process.env.PORT || 3000;

// 1. Render / Proxy Fix (Session drop problem solve karne ke liye)
app.set('trust proxy', 1);

// 2. In-built Express body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 3. Secure Session Setup
app.use(session({
  secret: process.env.SESSION_SECRET || 'fast-mailer-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 8 // 8 hours
  }
}));

app.use(express.static(path.join(__dirname, 'public')));

// Authentication Guard
function requireLogin(req, res, next) {
  if (req.session?.loggedIn) return next();
  return res.redirect('/');
}

// --- ROUTES ---

app.get('/', (req, res) => {
  if (req.session?.loggedIn) return res.redirect('/launcher');
  return res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/launcher', requireLogin, (req, res) => {
  return res.sendFile(path.join(__dirname, 'public', 'launcher.html'));
});

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

app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    return res.json({ success: true });
  });
});

// Email API Route
app.post('/api/send-email', requireLogin, async (req, res) => {
  const { senderName, gmailId, appPassword, subject, messageBody, to } = req.body;

  // Complete Input Validation
  if (!gmailId || !appPassword || !to || !subject || !messageBody) {
    return res.status(400).json({ 
      success: false, 
      message: 'All fields (gmailId, appPassword, to, subject, messageBody) are required.' 
    });
  }

  // Sanitization: App password aur email ke spaces auto-remove karna
  const cleanAppPassword = appPassword.replace(/\s+/g, '');
  const cleanGmailId = gmailId.trim();
  const cleanTo = to.trim();

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { 
      user: cleanGmailId, 
      pass: cleanAppPassword 
    }
  });

  try {
    const info = await transporter.sendMail({
      from: senderName ? `"${senderName.trim()}" <${cleanGmailId}>` : cleanGmailId,
      to: cleanTo,
      subject: subject.trim(),
      text: messageBody
    });

    return res.json({ success: true, messageId: info.messageId });

  } catch (err) {
    console.error(`❌ Mail delivery error for [${cleanTo}]:`, err.message);
    return res.status(500).json({ 
      success: false, 
      message: err.message || 'Failed to send email. Check Gmail & App Password.' 
    });
  }
});

app.listen(PORT, () => console.log(`🚀 Fast Mailer running on port ${PORT}`));
