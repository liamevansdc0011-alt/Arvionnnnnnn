const express = require('express');
const session = require('express-session');
const nodemailer = require('nodemailer');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Modern Express built-in body parsing (body-parser package ki zaroorat nahi)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session Configuration (Secured cookies & HTTP Only)
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

// Static folder serve karne ke liye
app.use(express.static(path.join(__dirname, 'public')));

// Authentication Middleware
function requireLogin(req, res, next) {
  if (req.session?.loggedIn) return next();
  return res.redirect('/');
}

// --- ROUTES ---

// Login / Launcher Views
app.get('/', (req, res) => {
  if (req.session?.loggedIn) return res.redirect('/launcher');
  return res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/launcher', requireLogin, (req, res) => {
  return res.sendFile(path.join(__dirname, 'public', 'launcher.html'));
});

// Login Handler
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  
  // Environment variables ya fallback values
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
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ success: false, message: 'Logout failed' });
    res.clearCookie('connect.sid');
    return res.json({ success: true });
  });
});

// Send Email API
app.post('/api/send-email', requireLogin, async (req, res) => {
  const { senderName, gmailId, appPassword, subject, messageBody, to } = req.body;

  // Strict validation for required fields
  if (!gmailId || !appPassword || !to || !subject || !messageBody) {
    return res.status(400).json({ 
      success: false, 
      message: 'All fields (gmailId, appPassword, to, subject, messageBody) are required.' 
    });
  }

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: gmailId,
        pass: appPassword
      }
    });

    const mailOptions = {
      from: senderName ? `"${senderName}" <${gmailId}>` : gmailId,
      to: to,
      subject: subject,
      text: messageBody
    };

    const info = await transporter.sendMail(mailOptions);
    return res.json({ success: true, messageId: info.messageId });

  } catch (err) {
    console.error(`❌ Mail send error [Recipient: ${to}]:`, err.message);
    return res.status(500).json({ 
      success: false, 
      message: err.message || 'Failed to send email' 
    });
  }
});

app.listen(PORT, () => console.log(`🚀 Fast Mailer running on port ${PORT}`));
