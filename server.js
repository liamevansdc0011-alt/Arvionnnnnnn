const express = require('express');
const session = require('express-session');
const nodemailer = require('nodemailer');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// 1. Core Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 2. Session Management
app.use(session({
  secret: process.env.SESSION_SECRET || 'default-app-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production', // HTTPS only in production
    maxAge: 1000 * 60 * 60 * 8 // 8 Hours
  }
}));

// 3. Static Files Middleware
app.use(express.static(path.join(__dirname, 'public')));

// 4. Authentication Middleware
function authenticateUser(req, res, next) {
  if (req.session && req.session.isAuthenticated) {
    return next();
  }
  return res.status(401).redirect('/');
}

// --- 5. Page View Routes ---

// Root / Login Page
app.get('/', (req, res) => {
  if (req.session && req.session.isAuthenticated) {
    return res.redirect('/dashboard');
  }
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Protected Dashboard Page
app.get('/dashboard', authenticateUser, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// --- 6. Authentication APIs ---

// Login Endpoint
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;

  const validUsername = process.env.ADMIN_USER || 'admin';
  const validPassword = process.env.ADMIN_PASS || 'password123';

  if (username === validUsername && password === validPassword) {
    req.session.isAuthenticated = true;
    return res.json({ success: true, message: 'Login successful' });
  }

  return res.status(401).json({ success: false, message: 'Invalid credentials' });
});

// Logout Endpoint
app.post('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Logout failed' });
    }
    res.clearCookie('connect.sid');
    return res.json({ success: true, message: 'Logged out successfully' });
  });
});

// --- 7. Email Dispatch API ---

app.post('/api/send-email', authenticateUser, async (req, res) => {
  const { recipientEmail, subject, bodyText, senderTitle } = req.body;

  // Validate required fields
  if (!recipientEmail || !subject || !bodyText) {
    return res.status(400).json({ 
      success: false, 
      message: 'Recipient email, subject, and message body are required.' 
    });
  }

  // SMTP Configuration using Environment Variables
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;

  if (!smtpUser || !smtpPass) {
    return res.status(500).json({
      success: false,
      message: 'SMTP credentials are not configured on the server.'
    });
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: smtpUser,
      pass: smtpPass
    }
  });

  const mailDetails = {
    from: senderTitle ? `"${senderTitle}" <${smtpUser}>` : smtpUser,
    to: recipientEmail,
    subject: subject,
    text: bodyText
  };

  try {
    const info = await transporter.sendMail(mailDetails);
    return res.json({ 
      success: true, 
      message: 'Email dispatched successfully', 
      messageId: info.messageId 
    });
  } catch (error) {
    console.error('Email Dispatch Error:', error.message);
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to send email. Check SMTP setup or credentials.' 
    });
  }
});

// --- 8. Server Initialization ---
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
