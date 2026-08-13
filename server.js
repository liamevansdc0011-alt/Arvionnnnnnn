const express    = require('express');
const session    = require('express-session');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const path       = require('path');
require('dotenv').config();

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'fast-mailer-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 1000 * 60 * 60 * 8 }
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

// Same credentials as requested (@#@#@)
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

app.post('/api/send-email', requireLogin, async (req, res) => {
  const { senderName, gmailId, appPassword, subject, messageBody, to } = req.body;
  
  if (!gmailId || !appPassword || !to || !subject || !messageBody)
    return res.status(400).json({ success: false, message: 'Missing fields' });

  // Transporter configuration with connection pool optimization
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true, // SSL for stable authentication
    auth: { user: gmailId, pass: appPassword }
  });

  const fromAddress = senderName ? `"${senderName}" <${gmailId}>` : gmailId;

  try {
    const info = await transporter.sendMail({
      from: fromAddress,
      to,
      subject,
      text: messageBody, // Plain text is primary
      replyTo: gmailId,
      headers: {
        'X-Priority': '3', // Normal Priority (avoid '1' or high priority as spam filters flag it)
        'X-MSMail-Priority': 'Normal',
        'Importance': 'Normal'
      }
    });

    console.log(`✅ Sent to ${to} | ID: ${info.messageId}`);
    res.json({ success: true, messageId: info.messageId });
  } catch (err) {
    console.error(`❌ Error sending to ${to}:`, err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.listen(PORT, () => console.log(`🚀 Fast Mailer running on port ${PORT}`));
