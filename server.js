const express    = require('express');
const session    = require('express-session');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const path       = require('path');
require('dotenv').config();

const app  = express();
const PORT = process.env.PORT || 3000;

// Render reverse proxy fix (Fixes session cookie drop)
app.set('trust proxy', 1);

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'fast-mailer-secret-2024',
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

// Transporters store to reuse open SMTP pool sessions
const transporters = new Map();

// Helper to get or create a secure transporter for Gmail (Port 465 SSL)
function getTransporter(gmailId, appPassword) {
  const key = `${gmailId}_${appPassword}`;
  if (transporters.has(key)) {
    const cached = transporters.get(key);
    cached.lastUsed = Date.now();
    return cached.instance;
  }

  const instance = nodemailer.createTransport({
    pool: true,
    host: 'smtp.gmail.com',
    port: 465,
    secure: true, // SSL/TLS required for Render
    auth: {
      user: gmailId,
      pass: appPassword
    },
    maxConnections: 3,
    maxMessages: 200
  });

  transporters.set(key, {
    instance,
    lastUsed: Date.now()
  });

  return instance;
}

// Clean up idle transporters every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, cached] of transporters.entries()) {
    if (now - cached.lastUsed > 10 * 60 * 1000) {
      cached.instance.close();
      transporters.delete(key);
    }
  }
}, 5 * 60 * 1000);

// Helper Delay Function
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper: Convert raw text to HTML (Spam prevention technique)
function formatToHTML(text) {
  if (!text) return '';
  return text
    .split('\n')
    .map(line => line.trim() ? `<p style="margin:0 0 8px 0; font-family:Arial,sans-serif; color:#222; font-size:14px; line-height:1.5;">${line}</p>` : '<br/>')
    .join('');
}

// =========================================================================
// 🚀 BATCH EMAIL ROUTE (6-7 Mails per Batch | 25 Mails in ~24 Seconds)
// =========================================================================
app.post('/api/send-email', requireLogin, async (req, res) => {
  const { senderName, gmailId, appPassword, subject, messageBody, to, clientEmail, recipient, batch } = req.body;
  
  if (!gmailId || !appPassword) {
    return res.status(400).json({ success: false, message: 'Missing Gmail credentials' });
  }

  // 1. Agar request mein multiple emails ka array (batch) aaye:
  let emailList = [];
  if (Array.isArray(batch) && batch.length > 0) {
    emailList = batch;
  } else {
    // Single email fallback
    const target = to || clientEmail || recipient;
    if (target) emailList.push(target);
  }

  if (emailList.length === 0) {
    return res.status(400).json({ success: false, message: 'No recipient email addresses provided' });
  }

  try {
    const transporter = getTransporter(gmailId, appPassword);
    const BATCH_SIZE = 6;            // 6 to 7 emails per batch
    const IN_BATCH_DELAY = 200;       // 200ms gap inside batch
    const INTER_BATCH_DELAY = 4500;   // 4.5 seconds pause between batches

    const results = [];
    const fromAddress = senderName 
      ? `"${senderName.replace(/"/g, '')}" <${gmailId}>` 
      : `"${gmailId}" <${gmailId}>`;

    const htmlBody = formatToHTML(messageBody);

    // Loop through email list in batches of 6-7
    for (let i = 0; i < emailList.length; i += BATCH_SIZE) {
      const currentBatch = emailList.slice(i, i + BATCH_SIZE);

      // Process items inside current batch
      for (const rawTo of currentBatch) {
        const cleanTo = rawTo.trim().toLowerCase();
        
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanTo)) {
          results.push({ email: cleanTo, status: 'failed', error: 'Invalid Email Format' });
          continue;
        }

        try {
          await transporter.sendMail({
            from: fromAddress,
            replyTo: fromAddress,
            to: cleanTo,
            subject: subject || '',
            text: messageBody,        // Plain text fallback
            html: htmlBody           // Clean HTML (prevents spam flagging)
          });

          console.log(`✅ [Batch Delivery] -> ${cleanTo}`);
          results.push({ email: cleanTo, status: 'sent' });
        } catch (err) {
          console.error(`❌ [Batch Failed] -> ${cleanTo}:`, err.message);
          results.push({ email: cleanTo, status: 'failed', error: err.message });
        }

        // Micro delay inside batch (200ms)
        await sleep(IN_BATCH_DELAY);
      }

      // Inter-batch pause (4.5s) if more emails remain
      if (i + BATCH_SIZE < emailList.length) {
        console.log(`⏳ Batch pause for ${INTER_BATCH_DELAY}ms to prevent Gmail Spam Detection...`);
        await sleep(INTER_BATCH_DELAY);
      }
    }

    return res.json({
      success: true,
      totalSent: results.filter(r => r.status === 'sent').length,
      details: results
    });

  } catch (err) {
    console.error(`❌ Batch system error:`, err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Fast Mailer running on port ${PORT}`));
