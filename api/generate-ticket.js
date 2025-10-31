import { PDFDocument, rgb } from "pdf-lib";
import { google } from "googleapis";

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

    // === 🧾 Buat PDF ===
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595, 842]);

    // ✅ Font dari Google Fonts (tanpa upload)
    const fontUrl = "https://github.com/google/fonts/raw/main/ofl/notosans/NotoSans-Regular.ttf";
    const fontBytes = await fetch(fontUrl).then(res => res.arrayBuffer());
    const font = await pdfDoc.embedFont(fontBytes);

    const lines = [
      "🎫 NORAE HYBE — E-Ticket",
      "",
      `Nama: ${name}`,
      `Email: ${email}`,
      `WhatsApp: ${wa}`,
      `Social: ${social}`,
      `Fandom: ${fandom}`,
      `Jumlah Tiket: ${ticketCount}`,
      `Payment: ${payment}`,
      `Song Request: ${song || "-"}`,
      "",
      `Issued: ${issuedAt}`,
    ];

    let y = 780;
    for (const line of lines) {
      page.drawText(line, { x: 60, y, size: 12, font, color: rgb(0.2, 0.2, 0.2) });
      y -= 22;
    }

    const pdfBytes = await pdfDoc.save();
    const pdfBase64 = Buffer.from(pdfBytes).toString("base64");

    // === ✉️ Kirim email via Resend ===
    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    const RESEND_FROM = process.env.RESEND_FROM || "NORAEHYBE <onboarding@resend.dev>";

    if (!RESEND_API_KEY) {
      console.error("❌ RESEND_API_KEY missing");
      return res.status(500).json({ error: "Missing Resend API key" });
    }

    const emailPayload = {
      from: RESEND_FROM,
      to: [email],
      subject: "🎫 NORAE HYBE - E-Ticket",
      html: `<p>Hai ${name},</p>
             <p>Terima kasih sudah mendaftar di <b>NORAE HYBE</b>!</p>
             <p>Tiket kamu terlampir di bawah ini 🎶</p>
             <p><i>Issued at: ${issuedAt}</i></p>`,
      attachments: [
        {
          name: `NORAEHYBE_Ticket_${name}.pdf`,
          type: "application/pdf",
          data: pdfBase64,
        },
      ],
    };

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

    // === 📊 Simpan ke Google Sheets ===
    await appendToSheet({
      name,
      email,
      wa,
      social,
      fandom,
      tickets: String(ticketCount),
      payment,
      song,
      issuedAt,
    });

    return res.status(200).json({ success: true, message: "E-ticket sent successfully" });
  } catch (err) {
    console.error("❌ API ERROR:", err);
    return res.status(500).json({ error: err.message || "Internal Server Error" });
  }
}

/* === Fungsi bantu untuk simpan ke Google Sheets === */
async function appendToSheet(row) {
  const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
  const SA_BASE64 = process.env.GOOGLE_SERVICE_ACCOUNT;

  if (!SPREADSHEET_ID || !SA_BASE64) {
    console.warn("⚠️ Sheets env missing, skip append");
    return;
  }

  const saJson = JSON.parse(Buffer.from(SA_BASE64, "base64").toString("utf8"));
  if (saJson.private_key) saJson.private_key = saJson.private_key.replace(/\\n/g, "\n");

  const jwtClient = new google.auth.JWT({
    email: saJson.client_email,
    key: saJson.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  await jwtClient.authorize();
  const sheets = google.sheets({ version: "v4", auth: jwtClient });

  const values = [
    new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }),
    row.name,
    row.email,
    row.wa,
    row.social,
    row.fandom,
    row.tickets,
    row.payment,
    row.song,
    row.issuedAt,
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: "Sheet1!A1",
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    resource: { values: [values] },
  });

  console.log("✅ Data appended to Google Sheets");
}
