export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { email, name } = req.body;
  const displayName = name || 'there';

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'VeriAI Support <hello@veriai.in>',
      to: email,
      reply_to: 'support.veriai.team@gmail.com',
      subject: 'Welcome to VeriAI – your AI detection tool is ready',
      html: `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f8f9fa;font-family:'Helvetica Neue',Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f9fa;padding:40px 20px">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06)">
        
        <!-- Header -->
        <tr><td style="background:#2563eb;padding:28px 40px;text-align:center">
          <span style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-0.5px">VeriAI</span>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:36px 40px">
          <p style="font-size:22px;font-weight:700;color:#111827;margin:0 0 12px">Hey ${displayName}, welcome to VeriAI! 👋</p>
          <p style="font-size:15px;color:#6b7280;line-height:1.7;margin:0 0 24px">
            You now have access to one of the most accurate AI content detectors on the web — powered by Google Gemini.
          </p>

          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px">
            <tr>
              <td style="background:#f1f5ff;border-radius:10px;padding:20px">
                <p style="font-size:13px;font-weight:700;color:#2563eb;margin:0 0 12px;text-transform:uppercase;letter-spacing:0.05em">What you can do for free</p>
                <p style="font-size:14px;color:#374151;margin:0 0 8px">✅ &nbsp;25 text scans per day</p>
                <p style="font-size:14px;color:#374151;margin:0 0 8px">✅ &nbsp;Image, audio &amp; video detection</p>
                <p style="font-size:14px;color:#374151;margin:0">✅ &nbsp;Deepfake detection</p>
              </td>
            </tr>
          </table>

          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px">
            <tr><td align="center">
              <a href="https://veriai.in" style="display:inline-block;background:#2563eb;color:#ffffff;font-size:15px;font-weight:700;padding:14px 32px;border-radius:8px;text-decoration:none">
                Start your first scan →
              </a>
            </td></tr>
          </table>

          <p style="font-size:14px;color:#6b7280;line-height:1.7;margin:0">
            If you have any questions, just reply to this email — we are happy to help.<br><br>
            — Team VeriAI
          </p>
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:20px 40px;border-top:1px solid #e5e7eb;text-align:center">
          <p style="font-size:12px;color:#9ca3af;margin:0 0 6px">
            VeriAI · The Truth Layer for AI-Generated Content
          </p>
          <p style="font-size:11px;color:#9ca3af;margin:0">
            You received this email because you created an account at 
            <a href="https://veriai.in" style="color:#9ca3af">veriai.in</a>. 
            If this was not you, please ignore this email.
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`
    })
  });

  const data = await response.json();
  return res.status(200).json(data);
}
