export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { email, name } = req.body;

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
      subject: 'Welcome to VeriAI 👋',
      html: `
        <h2>Hey ${name || 'there'}, welcome to VeriAI!</h2>
        <p>You can now detect AI-generated content instantly.</p>
        <p><a href="https://veriai.in">Start your first scan →</a></p>
        <br/>
        <p>— Team VeriAI</p>
      `
    })
  });

  const data = await response.json();
  return res.status(200).json(data);
}
