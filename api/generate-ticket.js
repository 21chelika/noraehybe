// api/generate-ticket.js
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method Not Allowed" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    console.log("📩 Received data from frontend:", body);

    const { name, email } = body;

    if (!name || !email) {
      return res.status(400).json({ error: "Missing name or email" });
    }

    console.log("✅ Data diterima:", body);

    // tes aja dulu tanpa email/pdf
    return res.status(200).json({
      success: true,
      message: "Data OK",
      received: body,
    });

  } catch (err) {
    console.error("❌ Server Error:", err);
    return res.status(500).json({ error: err.message || "Internal Server Error" });
  }
}
