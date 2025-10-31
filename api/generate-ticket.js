// api/generate-ticket.js
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { google } from "googleapis";

const RESEND_API = "https://api.resend.com/emails";

export default async function handler(req, res) {
  console.log("🔥 [generate-ticket] API HIT");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    // --- Ambil data dari frontend
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    console.log("📩 Received body:", body);

    const {
      name = "",
      email = "",
      wa = "",
      social = "",
      fandom = "",
      tickets = "1",
      payment = "",
      song = "",
    } = body;

    // --- Validasi wajib
    if (!name || !email) {
      console.log("⚠️ Missing name or email");
      return res.status(400).json({ error: "Missing name or email" });
    }

    const ticketCount = Math.max(1, Math.min(100, Number(tickets || 1)));
    const issuedAt = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });

    // --- Buat PDF (simple version)
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595, 842]); // A4 Portrait
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    page.drawText("🎫 NORAE HYBE — E-Ticket", { x: 60, y: 780, size: 20, font, color: rgb(0.2, 0.2, 0.9) });
    page.drawText(`Nama: ${name}`, { x: 60, y: 740, size: 12, font });
    page.drawText(`Email: ${email}`, { x: 60, y: 720, size: 12, font });
    page.drawText(`WhatsApp: ${wa}`, { x: 60, y: 700, size: 12, font });
    page.drawText(`Social: ${social}`, { x: 60, y: 680, size: 12, font });
    page.drawText(`Fandom: ${fandom}`, { x: 60, y: 660, size: 12, font });
    page.drawText(`Tickets: ${ticketCount}`, { x: 60, y: 640, size: 12, font });
    page.drawText(`Payment: ${payment}`, { x: 60, y: 620, size: 12, font });
    page.drawText(`Song: ${song || "-"}`, { x: 60, y: 600, size: 12, font });
    page.drawText(`Issued at: ${issuedAt}`, { x: 60, y: 560, size: 10, font });

    const pdfBytes = await pdfDoc.save();
    const pdfBase64 = Buffer.from(pdfBytes).toString("base64");

    // --- Kirim Email via Resend
    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    const RESEND_FROM = process.env.RESEND_FROM || "NORAEHYBE <onboarding@resend.dev>";

    if (!RESEND_API_KEY) {
      console.error("❌ RESEND_API_KEY missing");
      return res.status(500).json({ error: "Missing Resend API key" });
    }

    const emailPayload = {
      from: RESEND_FROM,
      to: [email],
      subject: "🎫 NORAE HYBE - Your E-Ticket",
      html: `<p>Hai ${name},</p>
             <p>Terima kasih sudah mendaftar di <b>NORAE HYBE</b>!</p>
             <p>Tiketmu terlampir di bawah ini. 🎶</p>
             <p><i>Issued: ${issuedAt}</i></p>`,
      attachments: [
        { name: `NORAEHYBE_Ticket_${name}.pdf`, type: "application/pdf", data: pdfBase64 },
      ],
    };

    console.log("📦 Sending email to:", email);

    const resp = await fetch(RESEND_API, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(emailPayload),
    });

    const result = await resp.text();
    console.log("📧 Resend response:", result);

    if (!resp.ok) {
      return res.status(500).json({ error: "Failed to send email", detail: result });
    }

    return res.status(200).json({ success: true, message: "E-ticket sent successfully" });

  } catch (err) {
    console.error("❌ API ERROR:", err);
    return res.status(500).json({ error: err.message || "Internal Server Error" });
  }
}
