const express = require('express');
const session = require('express-session');
const nodemailer = require('nodemailer');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'fast-mailer-secret-2026',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 8
  }
}));

app.use(express.static(path.join(__dirname, 'public')));

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

// Login Handler with Automatic Redirect Fix
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const validUser = process.env.ADMIN_USER || '@#@#@';
  const validPass = process.env.ADMIN_PASS || '@#@#@';

  if (username === validUser && password === validPass) {
    req.session.loggedIn = true;
    
    // Check if AJAX request or standard form submit
    if (req.headers['content-type']?.includes('application/json')) {
      return res.json({ success: true, redirectUrl: '/launcher' });
    }
    return res.redirect('/launcher');
  }

  if (req.headers['content-type']?.includes('application/json')) {
    return res.status(401).json({ success: false, message: 'Invalid credentials' });
  }
  res.redirect('/?error=1');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

const transporterCache = new Map();

function getTransporter(gmailId, appPassword) {
  const cacheKey = `${gmailId.trim()}:${appPassword.trim()}`;
  
  if (!transporterCache.has(cacheKey)) {
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: {
        user: gmailId.trim(),
        pass: appPassword.trim()
      }
    });
    transporterCache.set(cacheKey, transporter);
  }
  return transporterCache.get(cacheKey);
}

function generateUniqueCode() {
  const randomHex = crypto.randomBytes(3).toString('hex').toUpperCase();
  const timeSuffix = Date.now().toString().slice(-4);
  return `REF-${randomHex}-${timeSuffix}`;
}

app.post('/api/send-email', requireLogin, async (req, res) => {
  const { senderName, gmailId, appPassword, subject, messageBody, to } = req.body;

  if (!gmailId || !appPassword || !to) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  try {
    const transporter = getTransporter(gmailId, appPassword);
    const uniqueId = generateUniqueCode();
    
    const cleanSender = gmailId.trim();
    const cleanSenderName = senderName ? senderName.replace(/["\r\n]/g, '').trim() : '';
    const cleanSubject = subject ? subject.replace(/[\r\n]/g, '').trim() : '';
    const rawText = messageBody ? messageBody.trim() : '';

    const formattedText = `${rawText}\n\nTracking Ref: ${uniqueId}`;
    const htmlBody = `
      <div style="font-family: Arial, sans-serif; font-size: 14px; color: #333; line-height: 1.6;">
        ${rawText.replace(/\n/g, '<br>')}
        <br><br>
        <hr style="border: none; border-top: 1px solid #eee; margin: 15px 0;" />
        <span style="font-size: 11px; color: #777;">Ref Code: ${uniqueId}</span>
      </div>
    `;

    const mailOptions = {
      from: cleanSenderName ? `"${cleanSenderName}" <${cleanSender}>` : `<${cleanSender}>`,
      replyTo: cleanSender,
      to: to.trim(),
      subject: cleanSubject,
      text: formattedText,
      html: htmlBody
    };

    await transporter.sendMail(mailOptions);
    res.json({ success: true, refCode: uniqueId });
  } catch (err) {
    console.error(`Mail error (${to}):`, err.message);
    res.status(500).json({ success: false, message: err.message || 'Failed to send' });
  }
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
