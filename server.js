const express    = require('express');
const session    = require('express-session');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const path       = require('path');
require('dotenv').config();

const app  = express();
const PORT = process.env.PORT || 3000;

// Trust proxy for Render environment (Fixes session loss)
app.set('trust proxy', 1);

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'fast-mailer-secret-2026',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 8
  }
}));

app.use(express.static(path.join(__dirname, 'public')));

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

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const validUser = process.env.ADMIN_USER || 'gggg';
  const validPass = process.env.ADMIN_PASS || 'gggg';
  if (username === validUser && password === validPass) {
    req.session.loggedIn = true;
    return res.json({ success: true });
  }
  res.json({ success: false, message: 'Invalid username or password' });
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// =========================================================================
// 🚀 SMART SEQUENTIAL QUEUE ENGINE (1 MAIL PER 1 SECOND STRICT)
// =========================================================================

const transporters = new Map();

// Optimized Transporter Cache
function getTransporter(gmailId, appPassword) {
  const key = `${gmailId}_${appPassword}`;
  if (transporters.has(key)) return transporters.get(key);

  const instance = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: gmailId,
      pass: appPassword
    }
  });

  transporters.set(key, instance);
  return instance;
}

// In-Memory Queue Store
const emailQueue = [];
let isProcessing = false;

// Background Queue Processor (Ensures 1 Mail / 1 Second Sequence)
async function processQueue() {
  if (isProcessing || emailQueue.length === 0) return;
  isProcessing = true;

  while (emailQueue.length > 0) {
    const job = emailQueue.shift(); // Get next email from line

    try {
      const transporter = getTransporter(job.gmailId, job.appPassword);

      const fromHeader = job.senderName 
        ? `"${job.senderName.replace(/"/g, '')}" <${job.gmailId}>` 
        : job.gmailId;

      // Clean Mail with Dual Plain Text + Clean Styled HTML (Natural Gmail Signing)
      await transporter.sendMail({
        from: fromHeader,
        replyTo: fromHeader,
        to: job.to,
        subject: job.subject || '',
        text: job.messageBody,
        html: `<div style="font-family: Arial, sans-serif; font-size: 14px; color: #111111; line-height: 1.6;">
                ${(job.messageBody || '').replace(/\n/g, '<br/>')}
               </div>`
      });

      console.log(`✅ [Inbox Sent] -> ${job.to}`);
    } catch (err) {
      console.error(`❌ [Failed] -> ${job.to}:`, err.message);
    }

    // ⏱️ STRICT 1-SECOND PAUSE BETWEEN EACH EMAIL (Prevents Spam Blocking)
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  isProcessing = false;
}

// Mail API Endpoint
app.post('/api/send-email', requireLogin, (req, res) => {
  const { senderName, gmailId, appPassword, subject, messageBody, to, clientEmail, recipient } = req.body;
  const targetEmail = to || clientEmail || recipient;

  if (!gmailId || !appPassword || !targetEmail) {
    return res.status(400).json({ success: false, message: 'Missing required parameters' });
  }

  const cleanTo = targetEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanTo)) {
    return res.status(400).json({ success: false, message: 'Invalid recipient email' });
  }

  // Push job into sequence queue
  emailQueue.push({
    senderName,
    gmailId,
    appPassword,
    subject,
    messageBody: messageBody || '',
    to: cleanTo
  });

  // Start background queue processing safely
  processQueue();

  res.json({
    success: true,
    message: `Mail added to queue successfully. Waiting line: ${emailQueue.length}`
  });
});

// Check remaining queue count API
app.get('/api/queue-status', requireLogin, (req, res) => {
  res.json({
    pendingEmails: emailQueue.length,
    isProcessing: isProcessing
  });
});

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Queue Mailer Engine Active on Port ${PORT}`));
