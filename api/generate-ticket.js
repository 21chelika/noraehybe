import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
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

    const {
      name = "",
      email = "",
      wa = "",
      social = "",
      fandom = "",
      tickets = "1",
      payment = "",
      paymentMethod = "",
      song = "",
      proofBase64 = "",
    } = body;

    if (!name || !email) {
      return res.status(400).json({ error: "Missing name or email" });
    }

    const ticketCount = Math.max(1, Math.min(100, Number(tickets || 1)));
    const issuedAt = new Date().toLocaleString("id-ID", {
      timeZone: "Asia/Jakarta",
    });

    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    const RESEND_FROM =
      process.env.RESEND_FROM || "NORAEHYBE <noreply@noraehybe.my.id>";

    if (!RESEND_API_KEY) {
      console.error("❌ RESEND_API_KEY missing");
      return res.status(500).json({ error: "Missing Resend API key" });
    }

    const normalizedPayment = payment.trim().toLowerCase();
    const normalizedMethod = paymentMethod.trim().toLowerCase();
    let emailPayload;

    // === 💰 FULL PAYMENT (PDF LUNAS)
    if (normalizedPayment.includes("full")) {
      const pdfDoc = await PDFDocument.create();
      const page = pdfDoc.addPage([595, 842]);
      // ⭐ PERBAIKAN FONT: Gunakan TimesRoman untuk encoding yang lebih aman
      const font = await pdfDoc.embedFont(StandardFonts.TimesRoman);

      // --- PERBAIKAN UTAMA DI SINI: HAPUS EMOJI DARI TEKS PDF
      const lines = [
        "NORAE HYBE — E-Ticket", // Dihapus: 🎫
        "",
        `Nama: ${name}`,
        `Email: ${email}`,
        `WhatsApp: ${wa}`,
        `Social: ${social}`,
        `Fandom: ${fandom}`,
        `Jumlah Tiket: ${ticketCount}`,
        `Status Pembayaran: LUNAS`, // Dihapus: ✅
        `Metode Pembayaran: ${paymentMethod}`,
        "",
        `Song Request: ${song || "-"}`,
        `Issued: ${issuedAt}`,
      ];

      let y = 780;
      for (const line of lines) {
        page.drawText(line, { x: 60, y, size: 12, font, color: rgb(0, 0, 0) });
        y -= 22;
      }

      const pdfBytes = await pdfDoc.save();
      const pdfBase64 = Buffer.from(pdfBytes).toString("base64");

      emailPayload = {
        from: RESEND_FROM,
        to: [email],
        // Dihapus: 🎫
        subject: "NORAE HYBE - E-Ticket (LUNAS)",
        html: `
          <p>Hai ${name},</p>
          <p>Terima kasih sudah melakukan <b>pembayaran penuh (Full Payment)</b> untuk <b>NORAE HYBE</b>!</p>
          <p>Pembayaran kamu via <b>${paymentMethod}</b> telah kami terima.</p>
          <p>Tiket kamu terlampir di bawah ini.</p> <p><i>Issued at: ${issuedAt}</i></p>
        `,
        attachments: [
          {
            name: `NORAEHYBE_Ticket_${name}.pdf`,
            type: "application/pdf",
            content: pdfBase64,
          },
        ],
      };
    }

    // === 💵 DP (Down Payment)
    else if (normalizedPayment.includes("dp")) {
      let targetText = "";
      if (normalizedMethod.includes("blu")) {
        targetText = "Blu by BCA Digital — 001045623223 (Thia Anisyafitri)";
      } else if (normalizedMethod.includes("shopee")) {
        targetText = "ShopeePay — 081221994247 (Thia Anisyafitri)";
      } else if (normalizedMethod.includes("dana")) {
        targetText = "DANA — 081221994247 (Thia Anisyafitri)";
      } else {
        targetText = "Hubungi panitia untuk detail rekening pembayaran.";
      }

      emailPayload = {
        from: RESEND_FROM,
        to: [email],
        // Dihapus: 💰
        subject: "NORAE HYBE - Instruksi Pembayaran DP",
        html: `
          <p>Halo <b>${name}</b>,</p>
          <p>Terima kasih sudah mendaftar <b>NORAE HYBE</b>!</p>
          <p>Kamu memilih <b>DP (Down Payment)</b> sebesar Rp50.000.</p>
          <p>Metode pembayaran: <b>${paymentMethod}</b></p>
          <p>Silakan lakukan pembayaran ke:</p>
          <ul><li>${targetText}</li></ul>
          <p>Setelah pembayaran, kirim bukti ke panitia (Odi – +62 895-3647-33788).</p>
          <p>Terima kasih!</p> `,
      };
    }

    // === 📋 Fallback (lainnya)
    else {
      emailPayload = {
        from: RESEND_FROM,
        to: [email],
        // Dihapus: 📋
        subject: "NORAE HYBE - Registration Received",
        html: `
<p>Halo <b>${name}</b>,</p>
<p>Terima kasih sudah mendaftar <b>NORAE HYBE</b>!</p> <p>Kami sudah menerima datamu dengan baik.</p>
<p>Jika <b>PDF E-ticket</b> belum kamu terima, silakan hubungi:</p>
<p>📞 ODI (WhatsApp: +62 895-3647-33788)</p>
<p>Dan jangan lupa bergabung ke grup peserta di sini:<br>
<a href="https://chat.whatsapp.com/E1Vs1uySRU6LBkx6xwHmTd?mode=wwt">Grup WhatsApp NORAE HYBE</a></p>
<p>Kami akan segera mengirimkan konfirmasi lebih lanjut 💬</p>
<p>Salam hangat,<br><b>Tim NORAE HYBE</b></p>

        `,
      };
    }

    // === Upload Bukti ke imgbb (kalau ada)
    let proofUrl = null;
    if (proofBase64) {
      proofUrl = await uploadToImgbb(proofBase64);
    }

    // === Kirim email
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
      return res
        .status(500)
        .json({ error: "Failed to send email", detail: result });
    }

    // === Simpan ke Google Sheet
    await appendToSheet({
      name,
      email,
      wa,
      social,
      fandom,
      tickets: String(ticketCount),
      payment,
      paymentMethod,
      song,
      issuedAt,
      proofUrl,
    });

    return res
      .status(200)
      .json({ success: true, message: "Email sent successfully" });
  } catch (err) {
    console.error("❌ API ERROR:", err);
    return res
      .status(500)
      .json({ error: err.message || "Internal Server Error" });
  }
}

/* === Upload ke imgbb === */
async function uploadToImgbb(base64Image) {
  try {
    const apiKey = process.env.IMGBB_API_KEY;
    if (!apiKey) {
      console.error("❌ IMGBB_API_KEY missing");
      return null;
    }

    if (!base64Image || !base64Image.startsWith("data:image")) {
      console.warn("⚠️ No valid base64 image provided");
      return null;
    }

    const form = new FormData();
    form.append("image", base64Image.split(",")[1]);

    const resp = await fetch(`https://api.imgbb.com/1/upload?key=${apiKey}`, {
      method: "POST",
      body: form,
    });

    const data = await resp.json();
    if (data?.data?.url) {
      console.log("✅ Bukti pembayaran terupload:", data.data.url);
      return data.data.url;
    } else {
      console.error("❌ Upload ke imgbb gagal:", data);
      return null;
    }
  } catch (err) {
    console.error("❌ Upload error:", err);
    return null;
  }
}

/* === Google Sheets Helper === */
async function appendToSheet(row) {
  const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
  const SA_BASE64 = process.env.GOOGLE_SERVICE_ACCOUNT;

  if (!SPREADSHEET_ID || !SA_BASE64) {
    console.warn("⚠️ Sheets env missing, skip append");
    return;
  }

  const saJson = JSON.parse(Buffer.from(SA_BASE64, "base64").toString("utf8"));
  if (saJson.private_key)
    saJson.private_key = saJson.private_key.replace(/\\n/g, "\n");

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
    row.paymentMethod,
    row.song,
    row.issuedAt,
    row.proofUrl || "-",
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


