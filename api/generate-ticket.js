import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const RESEND_API = "https://api.resend.com/emails";

export default async function handler(req, res) {
  console.log("🔥 [generate-ticket] API HIT");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    console.log("📩 Received body:", body);

    const { name = "", email = "", wa = "", social = "", fandom = "", tickets = "1", payment = "", song = "" } = body;

    if (!name || !email) {
      return res.status(400).json({ error: "Missing name or email" });
    }

    const ticketCount = Math.max(1, Math.min(100, Number(tickets || 1)));
    const issuedAt = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });

    // === Buat PDF ===
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595, 842]);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    const lines = [
      "NORAE HYBE — E-Ticket",
      `Nama: ${name}`,
      `Email: ${email}`,
      `WhatsApp: ${wa}`,
      `Social: ${social}`,
      `Fandom: ${fandom}`,
      `Tickets: ${ticketCount}`,
      `Payment: ${payment}`,
      `Song: ${song || "-"}`,
      `Issued at: ${issuedAt}`,
    ];

    let y = 780;
    for (const line of lines) {
      page.drawText(line, { x: 60, y, size: 12, font, color: rgb(0, 0, 0) });
      y -= 20;
    }

    const pdfBytes = await pdfDoc.save();
    const pdfBase64 = Buffer.from(pdfBytes).toString("base64");

    // === Kirim email ===
    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    const RESEND_FROM = process.env.RESEND_FROM || "NORAEHYBE <onboarding@resend.dev>";

    if (!RESEND_API_KEY) {
      console.error("❌ RESEND_API_KEY missing");
      return res.status(500).json({ error: "Missing Resend API key" });
    }

    const emailPayload = {
      from: RESEND_FROM,
      to: [email],
      subject: "NORAE HYBE - Your E-Ticket",
      html: `<p>Hai ${name},</p>
             <p>Terima kasih sudah mendaftar di <b>NORAE HYBE</b>!</p>
             <p>Tiketmu terlampir di bawah ini.</p>
             <p><i>Issued: ${issuedAt}</i></p>`,
      attachments: [
        {
          name: `NORAEHYBE_Ticket_${name}.pdf`,
          type: "application/pdf",
          data: pdfBase64,
        },
      ],
    };

    console.log("📦 Sending email to:", email);

    const resp = await fetch(RESEND_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
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
