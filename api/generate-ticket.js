// api/generate-ticket.js
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { google } from "googleapis";

const RESEND_API = "https://api.resend.com/emails";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

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
      logoBase64 = null,
      proofBase64 = null
    } = body;

    if (!email || !name) return res.status(400).json({ error: "Missing name or email" });

    const ticketCount = Math.max(1, Math.min(100, Number(tickets || 1)));
    const issuedAt = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });

    // try to embed logo (optional) - prepare bytes now
    let logoImageBytes = null;
    if (logoBase64) {
      try {
        const rawLogo = stripBase64(logoBase64);
        logoImageBytes = Buffer.from(rawLogo, "base64");
      } catch (e) {
        console.warn("logoBase64 -> parse failed", e);
        logoImageBytes = null;
      }
    }

    // proof bytes (optional)
    let proofBytes = null;
    if (proofBase64) {
      try { proofBytes = Buffer.from(stripBase64(proofBase64), "base64"); }
      catch (e) { proofBytes = null; }
    }

    // ---------- CREATE PDF (only if Full payment) ----------
    let pdfBase64 = null;
    if (payment === "Full") {
      const pdfDoc = await PDFDocument.create();
      const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);

      // try embed logo image object if bytes available
      let logoImage = null;
      if (logoImageBytes) {
        try {
          // try png then jpg
          try { logoImage = await pdfDoc.embedPng(logoImageBytes); }
          catch (_) { logoImage = await pdfDoc.embedJpg(logoImageBytes); }
        } catch (e) {
          console.warn("Logo embed failed:", e?.message || e);
          logoImage = null;
        }
      }

      // create pages equal to ticketCount
      for (let i = 0; i < ticketCount; i++) {
        const width = 842;   // landscape A4 approx
        const height = 595;
        const page = pdfDoc.addPage([width, height]);

        // background
        page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(0.06, 0.06, 0.06) });

        // logo
        let yStart = height - 70;
        if (logoImage) {
          try {
            const scaleFactor = Math.min(300 / logoImage.width, 60 / logoImage.height);
            const w = Math.min(300, logoImage.width * scaleFactor);
            const h = (logoImage.height / logoImage.width) * w;
            const x = (width - w) / 2;
            const y = height - 90;
            page.drawImage(logoImage, { x, y, width: w, height: h });
            yStart = y - 10;
          } catch (e) {
            // continue without logo
            console.warn("drawing logo failed", e);
          }
        }

        // Title
        page.drawText("NORAE HYBE — E-Ticket", {
          x: 48, y: yStart, size: 18, font: helvetica, color: rgb(0.96, 0.96, 0.96)
        });

        // Ticket index
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

        const lines = wrapText(song || "-", 48);
        for (const ln of lines) {
          page.drawText(ln, { x: rx, y: ry, size: 10, font: helvetica, color: rgb(0.9,0.9,0.9) });
          ry -= 12;
        }

        // footer
        page.drawText(`Tickets: ${ticketCount}`, { x: 48, y: 28, size: 9, font: helvetica, color: rgb(0.65,0.65,0.65) });
        page.drawText(`Issued: ${issuedAt}`, { x: width - 260, y: 28, size: 9, font: helvetica, color: rgb(0.65,0.65,0.65) });

        // embed proof thumbnail (if any) - try jpg then png
        if (proofBytes) {
          try {
            let proofImg = null;
            try { proofImg = await pdfDoc.embedJpg(proofBytes); }
            catch (_) { proofImg = await pdfDoc.embedPng(proofBytes); }
            if (proofImg) {
              const pscale = Math.min(100 / proofImg.width, 60 / proofImg.height);
              const pw = proofImg.width * pscale;
              const ph = proofImg.height * pscale;
              page.drawImage(proofImg, { x: width - pw - 48, y: 48, width: pw, height: ph });
            }
          } catch (e) {
            // ignore embed error
            console.warn("proof embed failed", e?.message || e);
          }
        }
      } // end pages

      const pdfBytes = await pdfDoc.save();
      pdfBase64 = Buffer.from(pdfBytes).toString("base64");
    } // end if Full

    // ---------- WRITE TO GOOGLE SHEETS ----------
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
        status: payment === "Full" ? "LUNAS" : "BELUM LUNAS"
      });
    } catch (sheetErr) {
      console.warn("appendToSheet failed (non-fatal):", sheetErr);
      // continue; don't block email sending
    }

    // ---------- SEND EMAIL VIA RESEND ----------
    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    const RESEND_FROM = process.env.RESEND_FROM || "NORAEHYBE Ticketing <onboarding@resend.dev>";
    if (!RESEND_API_KEY) {
      console.error("RESEND_API_KEY missing");
      return res.status(500).json({ error: "Resend API key missing in env" });
    }

    let subject = "";
    let html = "";

    if (payment === "Full") {
      subject = "🎫 NORAE HYBE - Full Payment Confirmation + E-Ticket";
      html = `<div style="font-family:Arial, Helvetica, sans-serif; color:#111;">
        <h2>🎫 NORAE HYBE - E-Ticket Confirmation</h2>
        <p>Halo ${escapeHtml(name)},</p>
        <p>Terima kasih telah melakukan pembayaran <b>FULL</b> untuk acara <b>NORAE HYBE</b>! 🎉</p>
        <p>Tiketmu (${ticketCount}) terlampir pada email ini. Tunjukkan tiket tersebut pada saat registrasi.</p>
        <p><b>Song Request:</b> ${escapeHtml(song || "-")}</p>
        <p>— NORAE HYBE Ticketing</p>
      </div>`;
    } else {
      subject = "🎫 NORAE HYBE - Down Payment Confirmation";
      html = `<div style="font-family:Arial, Helvetica, sans-serif; color:#111;">
        <h2>🎫 NORAE HYBE - Down Payment Confirmation</h2>
        <p>Halo ${escapeHtml(name)},</p>
        <p>Terima kasih sudah melakukan pendaftaran untuk acara <b>NORAE HYBE</b>!</p>
        <p>Kamu memilih opsi pembayaran <b>Down Payment (DP)</b> sebesar <b>Rp50.000</b>.</p>
        <p>Silakan lakukan pelunasan ke rekening berikut:</p>
        <ul>
          <li>🏦 Blu by BCA Digital — 001045623223 (a.n Thia Anisyafitri)</li>
          <li>📱 ShopeePay — 081221994247 (a.n Thia Anisyafitri)</li>
        </ul>
        <p>Setelah melakukan pembayaran, kirim bukti transfer ke:</p>
        <p>📞 Odi — +62 895-3647-33788</p>
        <p>Tiketmu akan dikirim <b>setelah pelunasan dilakukan</b>.</p>
        <p>— NORAE HYBE Ticketing</p>
      </div>`;
    }

    // prepare payload
    const emailPayload = {
      from: RESEND_FROM,
      to: [email],
      subject,
      html,
      attachments: payment === "Full" && pdfBase64 ? [
        { name: `NORAEHYBE_e-ticket_${sanitizeFilename(name)}.pdf`, type: "application/pdf", data: pdfBase64 }
      ] : []
    };

    const resp = await fetch(RESEND_API, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(emailPayload)
    });

    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      console.error("Resend error:", resp.status, txt);
      // attempt to record failure to sheet
      try {
        await appendToSheet({
          name, email, wa, social, fandom, tickets: String(ticketCount), payment, song, status: "Failed to send email"
        }, true);
      } catch (e) {
        console.warn("append failure while reporting email failure", e);
      }
      return res.status(500).json({ error: "Failed to send email", detail: txt });
    }

    return res.status(200).json({ success: true, message: "Processed", issuedAt });
  } catch (err) {
    console.error("Handler error:", err);
    return res.status(500).json({ error: err.message || String(err) });
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
    else { if (cur) lines.push(cur); cur = w; }
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
Sheet headers:
Timestamp | Nama | Email | WhatsApp | Social Media | Fandom | Jumlah Tiket | Payment Method | Song Request | Status
*/

async function appendToSheet(rowObj, isUpdate = false) {
  try {
    const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
    const SA_BASE64 = process.env.GOOGLE_SERVICE_ACCOUNT;
    if (!SPREADSHEET_ID || !SA_BASE64) {
      throw new Error("Sheets env missing");
    }

    const saJson = JSON.parse(Buffer.from(SA_BASE64, "base64").toString("utf8"));
    if (saJson.private_key) saJson.private_key = saJson.private_key.replace(/\\n/g, "\n");

    const jwtClient = new google.auth.JWT({
      email: saJson.client_email,
      key: saJson.private_key,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"]
    });

    await jwtClient.authorize();
    const sheets = google.sheets({ version: "v4", auth: jwtClient });

    const values = [
      new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }),
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
    throw e;
  }
}
