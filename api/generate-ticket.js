// api/generate-ticket.js
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method Not Allowed" });
    }

    const data = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    console.log("📩 Received data from frontend:", data);

    const { name, email } = data;
    if (!name || !email) {
      return res.status(400).json({ error: "Missing name or email" });
    }

    // ✅ Kirim email via Resend
    try {
      const response = await resend.emails.send({
        from: process.env.RESEND_FROM,
        to: email,
        subject: "NORAE HYBE E-Ticket 🎟️",
        html: `
          <div style="font-family:Arial,sans-serif;">
            <h2>Hi ${name}!</h2>
            <p>Terima kasih sudah mendaftar di <b>NORAE HYBE</b>!</p>
            <p>Kami sudah menerima data kamu, dan tim kami akan segera menghubungi kamu melalui email atau WhatsApp.</p>
            <p>🎤 Jangan lupa siapkan semangatmu untuk bernyanyi!</p>
            <br>
            <small>✨ Project by HYBE Fans Community ✨</small>
          </div>
        `,
      });

      console.log("✅ Email sent:", response);
      return res.status(200).json({ success: true, message: "Email sent" });

    } catch (error) {
      console.error("❌ Resend error:", error);
      return res.status(500).json({ error: "Failed to send email" });
    }

  } catch (err) {
    console.error("❌ Server Error:", err);
    return res.status(500).json({ error: err.message || "Internal Server Error" });
  }
}
