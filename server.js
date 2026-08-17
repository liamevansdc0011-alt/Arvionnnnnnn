import 'dotenv/config';
import express from 'express';
import nodemailer from 'nodemailer';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Render sets process.env.PORT automatically
const PORT = process.env.PORT || 3000;
const SITE_PASSWORD = process.env.SITE_PASSWORD || '####';

// Middlewares
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Static files (login.html & launcher.html) serve karne ke liye
app.use(express.static(path.join(__dirname, "public")));

/* ==========================================================================
   1. HEALTH CHECK ROUTE (Render Ping)
   ========================================================================== */
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", timestamp: new Date() });
});

/* ==========================================================================
   2. AUTHENTICATION API
   ========================================================================== */
app.post("/api/auth", (req, res) => {
  const { password } = req.body;
  if (password === SITE_PASSWORD) {
    return res.json({ success: true });
  }
  return res.status(401).json({ success: false, message: "Incorrect password" });
});

/* ==========================================================================
   3. SMTP TRANSPORTER POOL
   ========================================================================== */
function getTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '465', 10),
    secure: process.env.SMTP_SECURE !== 'false', // true for 465, false for 587
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    },
    pool: true,
    maxConnections: 3,
    maxMessages: 100
  });
}

/* ==========================================================================
   4. SSE REAL-TIME MAIL STREAMING ENDPOINT
   ========================================================================== */
app.post("/api/send-stream", async (req, res) => {
  // Render Nginx buffering bypass headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const { subject, messageBody, recipients, senderName } = req.body;

  if (!subject || !messageBody || !Array.isArray(recipients) || recipients.length === 0) {
    res.write(`data: ${JSON.stringify({ success: false, error: "Missing required mail fields" })}\n\n`);
    res.end();
    return;
  }

  const transporter = getTransporter();
  const senderEmail = process.env.SMTP_USER;
  const formattedSender = senderName ? `"${senderName}" <${senderEmail}>` : senderEmail;

  for (let index = 0; index < recipients.length; index++) {
    const recipient = recipients[index]?.trim();
    if (!recipient) continue;

    res.write(': keep-alive\n\n');

    try {
      const mailOptions = {
        from: formattedSender,
        to: recipient,
        subject: subject,
        html: messageBody,
        headers: {
          'X-Mailer': 'Render-SecureMail-Engine/2.0',
          'List-Unsubscribe': `<mailto:${senderEmail}?subject=unsubscribe>`
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
      console.error(`[Mail Error] Target: ${recipient}:`, error.message);
      res.write(`data: ${JSON.stringify({
        success: false,
        recipient,
        error: error.message
      })}\n\n`);
    }

    // Rate Limiting (2 seconds delay between messages)
    if (index < recipients.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  res.write("data: [DONE]\n\n");
  res.end();
});

/* ==========================================================================
   5. ROUTING (Default Page Redirects to login.html)
   ========================================================================== */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.get("/launcher.html", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "launcher.html"));
});

// Fallback Route
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

/* ==========================================================================
   SERVER LISTEN (0.0.0.0 binding is required for Render)
   ========================================================================== */
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server executing and bound to 0.0.0.0:${PORT}`);
});
