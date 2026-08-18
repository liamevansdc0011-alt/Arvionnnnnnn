import 'dotenv/config';
import express from 'express';
import nodemailer from 'nodemailer';
import cors from 'cors';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

const PORT = process.env.PORT || 3000;
const SITE_PASSWORD = process.env.SITE_PASSWORD || '####';

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

app.use(express.static(path.join(__dirname, "public")));

/* ==========================================================================
   HEALTH CHECK ROUTE
   ========================================================================== */
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", timestamp: new Date() });
});

/* ==========================================================================
   AUTHENTICATION ROUTE
   ========================================================================== */
app.post("/api/auth", (req, res) => {
  const { password } = req.body;
  if (password === SITE_PASSWORD) {
    return res.json({ success: true });
  }
  return res.status(401).json({ success: false, message: "Incorrect password" });
});

/* ==========================================================================
   STREAMING MAIL SENDER ENDPOINT (Optimized Speed & Inbox Anti-Spam)
   ========================================================================== */
app.post("/api/send-stream", async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const { smtpUser, smtpPass, senderName, subject, messageBody, recipients } = req.body;

  if (!smtpUser || !smtpPass || !subject || !messageBody || !Array.isArray(recipients) || recipients.length === 0) {
    res.write(`data: ${JSON.stringify({ success: false, error: "Sender Email, App Password, Subject, Body & Recipients are required." })}\n\n`);
    res.end();
    return;
  }

  let transporter;
  try {
    transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: {
        user: smtpUser.trim(),
        pass: smtpPass.trim()
      },
      pool: true,
      maxConnections: 5,     // Speed boost: increased from 2 to 5 connections
      maxMessages: 100
    });
  } catch (err) {
    res.write(`data: ${JSON.stringify({ success: false, error: "Transporter error: " + err.message })}\n\n`);
    res.end();
    return;
  }

  const cleanSenderEmail = smtpUser.trim();
  const domain = cleanSenderEmail.split('@')[1] || 'gmail.com';
  const formattedSender = senderName ? `"${senderName.trim()}" <${cleanSenderEmail}>` : cleanSenderEmail;

  // HTML se plain-text extract karne ka helper (Inbox deliverability ke liye MIME multipart zaroori hai)
  const plainText = messageBody.replace(/<[^>]*>?/gm, '');

  for (let index = 0; index < recipients.length; index++) {
    const recipient = recipients[index]?.trim();
    if (!recipient) continue;

    res.write(': keep-alive\n\n');

    try {
      // Unique RFC-compliant Message-ID generate karna taaki spam filter bypass ho
      const randomHash = crypto.randomBytes(8).toString('hex');
      const uniqueMessageId = `<${Date.now()}.${randomHash}@${domain}>`;

      const mailOptions = {
        from: formattedSender,
        to: recipient,
        subject: subject,
        text: plainText,          // Anti-Spam: Text + HTML multipart content
        html: messageBody,
        messageId: uniqueMessageId,
        headers: {
          'X-Priority': '3',      // Normal priority (Spam filters high priority bulk emails ko flag karte hain)
          'X-MSMail-Priority': 'Normal',
          'Importance': 'Normal',
          'List-Unsubscribe': `<mailto:${cleanSenderEmail}?subject=unsubscribe>`,
          'Feedback-ID': `bulk-mail:${cleanSenderEmail}:${Date.now()}`
        }
      };

      const info = await transporter.sendMail(mailOptions);

      res.write(`data: ${JSON.stringify({
        success: true,
        recipient,
        messageId: info.messageId,
        progress: `${index + 1}/${recipients.length}`
      })}\n\n`);

    } catch (error) {
      console.error(`[Mail Error] ${recipient}:`, error.message);
      res.write(`data: ${JSON.stringify({
        success: false,
        recipient,
        error: error.message
      })}\n\n`);
    }

    // SPEED OPTIMIZATION:
    // Delay ko 2000ms se ghata kar ~1200ms (1.2 sec) kar diya hai.
    // Dynamic randomized delay spam filter pattern-matching ko confuse karta hai.
    if (index < recipients.length - 1) {
      const safeDynamicDelay = Math.floor(Math.random() * 400) + 1000; // 1000ms - 1400ms range
      await new Promise(resolve => setTimeout(resolve, safeDynamicDelay));
    }
  }

  res.write("data: [DONE]\n\n");
  res.end();
});

/* ==========================================================================
   ROUTING
   ========================================================================== */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.get("/launcher.html", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "launcher.html"));
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server active on port ${PORT}`);
});
