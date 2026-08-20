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
   CLEAN HTML TO PLAIN-TEXT CONVERTER (Proper MIME Structure)
   ========================================================================== */
function convertToPlainText(html) {
  if (!html) return "";
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\n\s*\n/g, '\n\n')
    .trim();
}

/* ==========================================================================
   STREAMING MAIL SENDER ENDPOINT (Anti-Spam & Direct Inbox Fix)
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
      secure: true, // SSL Connection
      auth: {
        user: smtpUser.trim(),
        pass: smtpPass.trim()
      },
      pool: true,
      maxConnections: 1, 
      maxMessages: 100,
      rateLimit: 1
    });
  } catch (err) {
    res.write(`data: ${JSON.stringify({ success: false, error: "Transporter error: " + err.message })}\n\n`);
    res.end();
    return;
  }

  const cleanSenderEmail = smtpUser.trim().toLowerCase();
  const formattedSender = senderName ? `"${senderName.trim()}" <${cleanSenderEmail}>` : cleanSenderEmail;

  for (let index = 0; index < recipients.length; index++) {
    const recipient = recipients[index]?.trim();
    if (!recipient) continue;

    res.write(': keep-alive\n\n');

    try {
      // Unique Reference ID per mail (Google Content Hash Bypass)
      const refCode = crypto.randomBytes(4).toString('hex').toUpperCase();
      const domain = cleanSenderEmail.split('@')[1] || 'gmail.com';
      const customMessageId = `<${Date.now()}.${refCode}@${domain}>`;
      const isHtml = /<[a-z][\s\S]*>/i.test(messageBody);

      // Footer addition for unique hash fingerprint
      const htmlFooter = `<br><br><div style="font-size: 11px; color: #888888; font-family: Arial, sans-serif; border-top: 1px solid #e0e0e0; padding-top: 8px;">Ref ID: #${refCode}</div>`;
      const textFooter = `\n\n---\nRef ID: #${refCode}`;

      // Authentic RFC Compliant Mail Options optimized for Inbox placement
      const mailOptions = {
        from: formattedSender,
        to: recipient,
        subject: subject,
        date: new Date(),
        messageId: customMessageId,
        headers: {
          'X-Mailer': 'NodeMailer Process',
          'X-Priority': '3',
          'X-MSMail-Priority': 'Normal',
          'Importance': 'Normal',
          'List-Unsubscribe': `<mailto:${cleanSenderEmail}?subject=unsubscribe>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
        }
      };

      if (isHtml) {
        mailOptions.html = messageBody + htmlFooter;
        mailOptions.text = convertToPlainText(messageBody) + textFooter;
      } else {
        mailOptions.text = messageBody + textFooter;
      }

      const info = await transporter.sendMail(mailOptions);

      res.write(`data: ${JSON.stringify({
        success: true,
        recipient,
        messageId: info.messageId,
        refCode: refCode,
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

    // SPEED CONTROL: Exact same delay intact (1.0s to 1.4s)
    if (index < recipients.length - 1) {
      const safeDynamicDelay = Math.floor(Math.random() * 400) + 1000;
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
