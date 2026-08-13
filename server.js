const express   = require('express');
const session   = require('express-session');
const nodemailer = require('nodemailer');
const path      = require('path');
require('dotenv').config();

const app  = express();
const PORT = process.env.PORT || 3000;

// Render proxy settings (Session redirection fix ke liye mandatory)
app.set('trust proxy', 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session Setup
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

// Authentication Middleware
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
  req.session.destroy(() => res.json({ success: true }));
});

// Email API Route
app.post('/api/send-email', requireLogin, async (req, res) => {
  const { senderName, gmailId, appPassword, subject, messageBody, to } = req.body;

  if (!gmailId || !appPassword || !to || !subject || !messageBody) {
    return res.status(400).json({ success: false, message: 'All fields are required' });
  }

  // App Password se spaces automatic remove karna taaki format error na aaye
  const cleanAppPassword = appPassword.replace(/\s+/g, '');
  const cleanGmailId = gmailId.trim();

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: cleanGmailId,
      pass: cleanAppPassword
    }
  });

  try {
    const info = await transporter.sendMail({
      from: senderName ? `"${senderName}" <${cleanGmailId}>` : cleanGmailId,
      to: to.trim(),
      subject: subject,
      text: messageBody
    });

    return res.json({ success: true, messageId: info.messageId });
  } catch (err) {
    console.error(`❌ Mail send error [${to}]:`, err.message);
    return res.status(500).json({ 
      success: false, 
      message: err.message || 'SMTP Authentication failed' 
    });
  }
});

app.listen(PORT, () => console.log(`🚀 Fast Mailer running on port ${PORT}`));
