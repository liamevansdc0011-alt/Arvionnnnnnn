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
   UTILITY FUNCTIONS FOR ANTI-SPAM & UNIQUE CONTENT GENERATION
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

// Invisible Zero-Width Space Generator (Makes every email content byte-level unique)
function generateInvisibleHash() {
  const zwChars = ['\u200B', '\u200C', '\u200D', '\uFEFF'];
  let hash = '';
  for (let i = 0; i < 12; i++) {
    hash += zwChars[Math.floor(Math.random() * zwChars.length)];
  }
  return hash;
}

// Generate human-like professional email footer with subtle custom variation
function generateCustomFooter(recipient) {
  const token = crypto.randomBytes(4).toString('hex').toUpperCase();
  const domain = recipient.split('@')[1] || 'domain';
  
  const htmlFooter = `
    <br><br>
    <div style="margin-top: 20px; padding-top: 10px; border-top: 1px solid #eeeeee; font-size: 11px; color: #777777; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
      <span>Communication dispatch for: <strong>${recipient}</strong></span>
      <span style="display:none">${generateInvisibleHash()}</span>
      <div style="font-size: 9px; color: #aaaaaa; margin-top: 4px;">Security Verification Code: SEC-${token}-${domain.substring(0, 3).toUpperCase()}</div>
    </div>`;

  const textFooter = `\n\n---\nCommunication dispatch for: ${recipient}\nSecurity Verification Code: SEC-${token}-${domain.substring(0, 3).toUpperCase()}`;

  return { htmlFooter, textFooter };
}

/* ==========================================================================
   STREAMING MAIL SENDER ENDPOINT
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

  const cleanSenderEmail = smtpUser.trim().toLowerCase();
  const formattedSender = senderName ? `"${senderName.trim()}" <${cleanSenderEmail}>` : cleanSenderEmail;

  let transporter;
  try {
    transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: {
        user: cleanSenderEmail,
        pass: smtpPass.trim()
      },
      pool: true,
      maxConnections: 1,
      maxMessages: 200,
      rateLimit: 1 // 1 mail per burst target
    });
  } catch (err) {
    res.write(`data: ${JSON.stringify({ success: false, error: "Transporter error: " + err.message })}\n\n`);
    res.end();
    return;
  }

  for (let index = 0; index < recipients.length; index++) {
    const recipient = recipients[index]?.trim();
    if (!recipient) continue;

    res.write(': keep-alive\n\n');

    try {
      const isHtml = /<[a-z][\s\S]*>/i.test(messageBody);
      const { htmlFooter, textFooter } = generateCustomFooter(recipient);
      const uniqueMsgId = `<${Date.now()}.${crypto.randomBytes(4).toString('hex')}@gmail.com>`;

      const mailOptions = {
        from: formattedSender,
        to: recipient,
        subject: subject,
        date: new Date(),
        messageId: uniqueMsgId,
        headers: {
          'List-Unsubscribe': `<mailto:${cleanSenderEmail}?subject=unsubscribe>`,
          'X-Entity-Ref-ID': crypto.randomBytes(6).toString('hex')
        }
      };

      if (isHtml) {
        mailOptions.html = messageBody + htmlFooter;
        mailOptions.text = convertToPlainText(messageBody) + textFooter;
      } else {
        mailOptions.text = messageBody + textFooter + `\n${generateInvisibleHash()}`;
      }

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

    // EXACT SPEED CONTROL: 1 second per mail (1000ms - 1100ms jitter)
    if (index < recipients.length - 1) {
      const safeDelay = 1000 + Math.floor(Math.random() * 100);
      await new Promise(resolve => setTimeout(resolve, safeDelay));
    }
  }

  transporter.close();
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
