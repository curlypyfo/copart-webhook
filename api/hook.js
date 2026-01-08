export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("POST only");

  const BOT_TOKEN = process.env.BOT_TOKEN;
  const CHAT_ID = process.env.CHAT_ID;
  const SECRET = process.env.WEBHOOK_SECRET;

  if (SECRET && req.query?.token !== SECRET) {
    return res.status(401).json({ ok: false, error: "bad token" });
  }

  const data = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});

  const lotId = data.lot_id || data.lotId || data.lot || "";
  const vin = data.vin || "";
  const odo = data.odometer || data.odo || "";
  const price = data.price || data.bid || "";
  const located = data.location || data.located || "";
  const name = data.name || data.seller || "";
  const url = data.url || data.copart_url || (lotId ? `https://www.copart.com/lot/${lotId}` : "");
  const source = data.source || "webhook";

  const text =
`⚡ NEW LOT (${source})
${lotId ? `Lot: ${lotId}` : ""}
${vin ? `VIN: ${vin}` : ""}
${odo ? `ODO: ${odo}` : ""}
${price ? `Price: ${price}` : ""}
${located ? `Located: ${located}` : ""}
${name ? `Name: ${name}` : ""}
${url ? `\n${url}` : ""}`.trim();

  const tgResp = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text,
      disable_web_page_preview: false
    })
  });

  const tgJson = await tgResp.json();
  if (!tgJson.ok) return res.status(500).json({ ok: false, telegram: tgJson });

  res.status(200).json({ ok: true });
}
