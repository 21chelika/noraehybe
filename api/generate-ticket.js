// api/generate-ticket.js
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { google } from "googleapis";

const RESEND_API = "https://api.resend.com/emails";

export default async function handler(req, res) {
  try {
    // ✅ hanya izinkan POST
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method Not Allowed" });
    }

    // ✅ pastikan body sudah terbaca
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    console.log("📩 Received data from frontend:", body);

    // ✅ validasi awal
    if (!body.name || !body.email) {
      return res.status(400).json({ error: "Missing name or email" });
    }

    // Destructure data
    const {
      name = "",
      email = "",
      wa = "",
      social = "",
      fandom = "",
      tickets = "1",
      payment = "",
      song = "",
      logoBase64 = null,
      proofBase64 = null
    } = body;

    const ticketCount = Math.max(1, Math.min(100, Number(tickets || 1)));
    const issuedAt = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });

    console.log("✅ Data diterima:", {
      name,
      email,
      wa,
      social,
      fandom,
      tickets,
      payment,
      song,
    });

    /* ----------------------- PDF GENERATION ----------------------- */
    let pdfBase64 = null;

    if (payment === "Full") {
      const pdfDoc = await PDFDocument.create();
      const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);

      const page = pdfDoc.addPage([595, 842]); // portrait A4
      page.drawText("NORAE HYBE — E-Ticket", { x: 50, y: 780, size: 18, font: helvetica, color: rgb(0, 0, 0) });
      page.drawText(`Name: ${name}`, { x: 50, y: 750, size: 12, font: helvetica });
      page.drawText(`Email: ${email}`, { x: 50, y: 735, size: 12, font: helvetica });
      page.drawText(`WhatsApp: ${wa}`, { x: 50, y: 720, size: 12, font: helvetica });
      page.drawText(`Fandom: ${fandom}`, { x: 50, y: 705, size: 12, font: helvetica });
      page.drawText(`Payment: ${payment}`, { x: 50, y: 690, size: 12, font: helvetica });
      page.drawText(`Song Request: ${song || "-"}`, { x: 50, y: 675, size: 12, font: helvetica });

      const pdfBytes = await pdfDoc.save();
      pdfBase64 = Buffer.from(pdfBytes).toString("base64");
    }

    /* ----------------------- GOOGLE SHEETS ----------------------- */
    try {
      await appendToSheet({
        name,
        email,
        wa,
        social,
        fandom,
        tickets: String(ticketCount),
        payment,
        song,
        status: payment === "Full" ? "LUNAS" : "BELUM LUNAS",
      });
    } catch (e) {
      console.warn("⚠️ appendToSheet failed:", e);
    }

    /* ----------------------- EMAIL SEND ----------------------- */
    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    if (!RESEND_API_KEY) {
      console.error("RESEND_API_KEY missing");
      return res.status(500).json({ error: "Resend API key missing in env" });
    }

    const RESEND_FROM = process.env.RESEND_FROM || "NORAEHYBE Ticketing <onboarding@resend.dev>";

    const subject =
      payment === "Full"
        ? "🎫 NORAE HYBE - Full Payment Confirmation + E-Ticket"
        : "🎫 NORAE HYBE - Down Payment Confirmation";

    const html =
      payment === "Full"
        ? `<div style="font-family:Arial, Helvetica, sans-serif;">
            <h2>🎫 NORAE HYBE - Full Payment Confirmation</h2>
            <p>Halo ${escapeHtml(name)}, tiketmu (${ticketCount}) sudah terlampir di email ini 🎉</p>
          </div>`
        : `<div style="font-family:Arial, Helvetica, sans-serif;">
            <h2>🎫 NORAE HYBE - Down Payment Confirmation</h2>
            <p>Halo ${escapeHtml(name)}, terima kasih sudah melakukan pendaftaran!</p>
            <p>Tiket akan dikirim setelah pelunasan dilakukan.</p>
          </div>`;

    const emailPayload = {
      from: RESEND_FROM,
      to: [email],
      subject,
      html,
      attachments:
        payment === "Full" && pdfBase64
          ? [{ name: `NORAEHYBE_e-ticket_${sanitizeFilename(name)}.pdf`, type: "application/pdf", data: pdfBase64 }]
          : [],
    };

    const resp = await fetch(RESEND_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(emailPayload),
    });

    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      console.error("Resend API error:", resp.status, txt);
      return res.status(500).json({ error: "Failed to send email", detail: txt });
    }

    return res.status(200).json({ success: true, message: "E-ticket sent successfully", issuedAt });
  } catch (err) {
    console.error("❌ Handler error:", err);
    return res.status(500).json({ error: err.message || "Internal Server Error" });
  }
}

/* ----------------------- HELPERS ----------------------- */

function escapeHtml(s = "") {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function sanitizeFilename(s = "") {
  return String(s).replace(/[^a-z0-9_\-\.]/gi, "_").slice(0, 64);
}

async function appendToSheet(rowObj) {
  try {
    const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
    const SA_BASE64 = process.env.GOOGLE_SERVICE_ACCOUNT;
    if (!SPREADSHEET_ID || !SA_BASE64) throw new Error("Sheets env missing");

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
      rowObj.name,
      rowObj.email,
      rowObj.wa,
      rowObj.social,
      rowObj.fandom,
      rowObj.tickets,
      rowObj.payment,
      rowObj.song,
      rowObj.status,
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: "Sheet1!A1",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      resource: { values: [values] },
    });

    return { ok: true };
  } catch (e) {
    console.error("appendToSheet error:", e);
    throw e;
  }
}
