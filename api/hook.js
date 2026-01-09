export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });

    // защита токеном из URL ?token=...
    const secret = req.query.token;
    if (process.env.WEBHOOK_SECRET && secret !== process.env.WEBHOOK_SECRET) {
      return res.status(401).json({ ok: false, error: "bad token" });
    }

    const body = req.body || {};
    const raw = JSON.stringify(body);

    // 1) достаём lot_id (поддерживаем разные форматы)
    let lotId =
      body.lot_id ||
      body.lotId ||
      body?.data?.lot_id ||
      body?.data?.lotId ||
      "";

    // если lot_id нет — пробуем вытащить из ссылки
    if (!lotId) {
      const m = raw.match(/copart\.com\/lot\/(\d+)/i);
      if (m) lotId = m[1];
    }

    if (!lotId) return res.status(200).json({ ok: true, skipped: true, reason: "NO_LOT_ID" });

    // 2) спрашиваем VIN у твоего Mac (через tunnel)
    const vinUrl = `${process.env.VIN_RESOLVER_URL}&lot_id=${encodeURIComponent(lotId)}`;
    const vinResp = await fetch(vinUrl);
    const vinJson = await vinResp.json();

    const vin = vinJson?.vin || "";
    const odometer = vinJson?.odometer || "";

    // 3) формируем сообщение (пока без MMR)
    const copartLink = `https://www.copart.com/lot/${lotId}`;
    const msg = [
      "⚡ NEW LOT",
      `Lot: ${lotId}`,
      vin ? `VIN: ${vin}` : "VIN: (not found)",
      odometer ? `Odo: ${odometer}` : "Odo: (n/a)",
      copartLink,
    ].join("\n");

    // 4) отправляем в Telegram
    const tgUrl = `https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`;
    await fetch(tgUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: process.env.CHAT_ID,
        text: msg,
        disable_web_page_preview: false
      }),
    });

    return res.status(200).json({ ok: true, lotId, vin, odometer });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
}
