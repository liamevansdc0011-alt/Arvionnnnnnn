await transporter.sendMail({
  from: senderName ? `"${senderName}" <${gmailId}>` : gmailId,
  to,
  subject,
  text: messageBody,
  headers: {
    'X-Mailer': 'FastMailer', // simple custom header
    'Precedence': 'bulk' // avoid this if personal, keep minimal headers
  }
});
