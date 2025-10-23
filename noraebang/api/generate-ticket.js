// api/generate-ticket.js
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { google } from "googleapis";

const RESEND_API = "https://api.resend.com/emails";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    // parse JSON body (Vercel may already parse; but safe-guard)
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    const {
      name = "",
      email = "",
      wa = "",
      social = "",
      fandom = "",
      tickets = "1",
      payment = "",
      song = "",
      logoBase64 = null,   // data:*;base64,....
      proofBase64 = null   // optional
    } = body;

    if (!email || !name) return res.status(400).json({ error: "Missing name or email" });

    const ticketCount = Math.max(1, Math.min(100, Number(tickets || 1)));

    // ---------- CREATE PDF ----------
    const pdfDoc = await PDFDocument.create();
    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
    let logoImage = null;

    // embed logo if provided (strip prefix)
    if (logoBase64) {
      try {
        const rawLogo = stripBase64(logoBase64);
        const bytes = Buffer.from(rawLogo, "base64");
        // try png then jpg
        try { logoImage = await pdfDoc.embedPng(bytes); } catch (e) { logoImage = await pdfDoc.embedJpg(bytes); }
      } catch (e) {
        console.warn("Logo embed failed:", e.message || e);
        logoImage = null;
      }
    }

    // embed proof thumbnail if provided later per page
    let proofBytes = null;
    if (proofBase64) {
      try { proofBytes = Buffer.from(stripBase64(proofBase64), "base64"); } catch (e) { proofBytes = null; }
    }

    for (let i = 0; i < ticketCount; i++) {
      const width = 842;   // landscape approx A4 842x595
      const height = 595;
      const page = pdfDoc.addPage([width, height]);

      // background dark
      page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(0.06, 0.06, 0.06) });

      // logo centered top
      let yStart = height - 70;
      if (logoImage) {
        const scaleFactor = Math.min(300 / logoImage.width, 60 / logoImage.height);
        const w = Math.min(300, logoImage.width * scaleFactor);
        const h = (logoImage.height / logoImage.width) * w;
        const x = (width - w) / 2;
        const y = height - 90;
        page.drawImage(logoImage, { x, y, width: w, height: h });
        yStart = y - 10;
      }

      // Title
      page.drawText("NORAE HYBE — E-Ticket", {
        x: 48, y: yStart, size: 18, font: helvetica, color: rgb(0.96, 0.96, 0.96)
      });

      // Ticket index top-right
      page.drawText(`Ticket ${i + 1} of ${ticketCount}`, {
        x: width - 200, y: yStart, size: 10, font: helvetica, color: rgb(0.85, 0.85, 0.85)
      });

      // left column details
      let cursor = yStart - 36;
      const gap = 18;
      page.drawText(`Name: ${name}`, { x: 48, y: cursor, size: 12, font: helvetica, color: rgb(0.95,0.95,0.95) });
      cursor -= gap;
      page.drawText(`Email: ${email}`, { x: 48, y: cursor, size: 11, font: helvetica, color: rgb(0.85,0.85,0.85) });
      cursor -= gap;
      page.drawText(`WhatsApp: ${wa}`, { x: 48, y: cursor, size: 11, font: helvetica, color: rgb(0.85,0.85,0.85) });
      cursor -= gap;
      page.drawText(`Social: ${social}`, { x: 48, y: cursor, size: 11, font: helvetica, color: rgb(0.85,0.85,0.85) });

      // right column
      let rx = width / 2 + 20;
      let ry = yStart - 36;
      page.drawText(`Fandom: ${fandom}`, { x: rx, y: ry, size: 12, font: helvetica, color: rgb(0.95,0.95,0.95) });
      ry -= gap;
      page.drawText(`Payment: ${payment}`, { x: rx, y: ry, size: 11, font: helvetica, color: rgb(0.85,0.85,0.85) });
      ry -= gap;
      page.drawText(`Song Request:`, { x: rx, y: ry, size: 11, font: helvetica, color: rgb(0.95,0.95,0.95) });
      ry -= 14;

      // wrap song request into lines of ~48 chars
      const lines = wrapText(song || "-", 48);
      for (const ln of lines) {
        page.drawText(ln, { x: rx, y: ry, size: 10, font: helvetica, color: rgb(0.9,0.9,0.9) });
        ry -= 12;
      }

      // footer
      page.drawText(`Tickets: ${ticketCount}`, { x: 48, y: 28, size: 9, font: helvetica, color: rgb(0.65,0.65,0.65) });
      page.drawText(`Issued: ${new Date().toLocaleString()}`, { x: width - 260, y: 28, size: 9, font: helvetica, color: rgb(0.65,0.65,0.65) });

      // embed proof thumbnail bottom-right if present
      if (proofBytes) {
        try {
          const proofImg = await pdfDoc.embedJpg(proofBytes).catch(async () => await pdfDoc.embedPng(proofBytes));
          const pscale = Math.min(100 / proofImg.width, 60 / proofImg.height);
          const pw = proofImg.width * pscale;
          const ph = proofImg.height * pscale;
          page.drawImage(proofImg, { x: width - pw - 48, y: 48, width: pw, height: ph });
        } catch (e) {
          // ignore embed error
        }
      }
    } // end for pages

    const pdfBytes = await pdfDoc.save();
    const pdfBase64 = Buffer.from(pdfBytes).toString("base64");

    // ---------- WRITE TO GOOGLE SHEETS ----------
    const sheetsResult = await appendToSheet({
      name, email, wa, social, fandom, tickets: String(ticketCount), payment, song, status: "E-ticket Sent ✅"
    });

    // ---------- SEND EMAIL VIA RESEND ----------
    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    const RESEND_FROM = process.env.RESEND_FROM || "NORAEHYBE Ticketing <onboarding@resend.dev>";
    if (!RESEND_API_KEY) {
      console.error("RESEND_API_KEY missing");
      return res.status(500).json({ error: "Resend API key missing in env" });
    }

    const html = `<div style="font-family:Arial, Helvetica, sans-serif; color:#111;">
      <h2>🎫 NORAE HYBE - E-Ticket Confirmation</h2>
      <p>Hi ${escapeHtml(name)},</p>
      <p>Thanks for registering — your e-ticket(s) (${ticketCount}) is attached. Show the ticket at the venue.</p>
      <p><b>Song request:</b> ${escapeHtml(song || "-")}</p>
      <p>— NORAEHYBE Ticketing</p>
    </div>`;

    const resp = await fetch(RESEND_API, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [email],
        subject: "🎫 NORAE HYBE - E-Ticket Confirmation!",
        html,
        attachments: [
          { name: `NORAEHYBE_e-ticket_${sanitizeFilename(name)}.pdf`, type: "application/pdf", data: pdfBase64 }
        ]
      })
    });

    if (!resp.ok) {
      const txt = await resp.text();
      console.error("Resend error:", txt);
      // update sheet status to Failed
      await appendToSheet({ name, email, wa, social, fandom, tickets: String(ticketCount), payment, song, status: "Failed to send email" }, true);
      return res.status(500).json({ error: "Failed to send email", detail: txt });
    }

    return res.status(200).json({ success: true, message: "E-ticket generated & sent" });

  } catch (err) {
    console.error("Handler error:", err);
    return res.status(500).json({ error: err.message });
  }
}

/* ---------------- Helpers ---------------- */

function stripBase64(s) {
  if (!s) return null;
  return s.replace(/^data:\w+\/[a-zA-Z+\-.]+;base64,/, "");
}

function wrapText(text, maxChars) {
  if (!text) return ["-"];
  const words = String(text).split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length <= maxChars) cur = (cur + " " + w).trim();
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

function escapeHtml(s = "") {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function sanitizeFilename(s = "") {
  return String(s).replace(/[^a-z0-9_\-\.]/gi, "_").slice(0, 64);
}

/* ---------- Google Sheets append ---------- */
/*
Requires env:
- SPREADSHEET_ID
- GOOGLE_SERVICE_ACCOUNT (base64-encoded service account JSON)
The sheet should have headers in first row:
Timestamp | Nama | Email | WhatsApp | Social Media | Fandom | Jumlah Tiket | Payment Method | Song Request | Status
*/

async function appendToSheet(rowObj, isUpdate=false) {
  try {
    const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
    const SA_BASE64 = process.env.GOOGLE_SERVICE_ACCOUNT;
    if (!SPREADSHEET_ID || !SA_BASE64) {
      console.warn("Google Sheets env missing");
      return { ok: false, reason: "Sheets env missing" };
    }

    const saJson = JSON.parse(Buffer.from(SA_BASE64, "base64").toString("utf8"));
    // private_key may contain escaped newlines
    if (saJson.private_key) saJson.private_key = saJson.private_key.replace(/\\n/g, "\n");

    const jwtClient = new google.auth.JWT({
      email: saJson.client_email,
      key: saJson.private_key,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"]
    });

    await jwtClient.authorize();
    const sheets = google.sheets({ version: "v4", auth: jwtClient });

    const values = [
      new Date().toLocaleString(),
      rowObj.name || "",
      rowObj.email || "",
      rowObj.wa || "",
      rowObj.social || "",
      rowObj.fandom || "",
      rowObj.tickets || "",
      rowObj.payment || "",
      rowObj.song || "",
      rowObj.status || ""
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: "Sheet1!A1",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      resource: { values: [values] }
    });

    return { ok: true };
  } catch (e) {
    console.error("appendToSheet error:", e);
    return { ok: false, error: e.message || e };
  }
}
