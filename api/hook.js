function withTimeout(ms, promise) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return Promise.race([
    promise(ctrl.signal).finally(() => clearTimeout(t)),
  ]);
}

function cleanStr(v) {
  return (v === undefined || v === null) ? "" : String(v).trim();
}

function isMaskedVin(vin) {
  const v = cleanStr(vin);
  return !v || v.includes("*") || v.length < 10;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("POST only");

  const BOT_TOKEN = process.env.BOT_TOKEN;
  const CHAT_ID = process.env.CHAT_ID;
  const SECRET = process.env.WEBHOOK_SECRET;

  if (SECRET && req.query?.token !== SECRET) {
    return res.status(401).json({ ok: false, error: "bad token" });
  }

  // optional bridges (позже добавим)
  const VIN_RESOLVER_URL = process.env.VIN_RESOLVER_URL; // напр. https://xxxx/resolveVin
  const MMR_BRIDGE_URL = process.env.MMR_BRIDGE_URL;     // напр. https://xxxx/getMmr

  let data = req.body;
  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch { data = { raw: data }; }
  }
  data = data || {};

  // поля от ребят (с запасом под разные ключи)
  const source = cleanStr(data.source) || "bot";
  const lotId  = cleanStr(data.lot_id || data.lotId || data.lot);
  let url      = cleanStr(data.url || data.copart_url);
  let vin      = cleanStr(data.vin);
  let odometer = cleanStr(data.odometer || data.odo || data.miles);
  let price    = cleanStr(data.price || data.bid);
  let title    = cleanStr(data.title_code || data.title);
  let seller   = cleanStr(data.seller_name || data.seller || data.name);

  if (!url && lotId) url = `https://www.copart.com/lot/${lotId}`;

  // 1) VIN-resolver (если VIN нет или со звёздочками)
  if (VIN_RESOLVER_URL && lotId && isMaskedVin(vin)) {
    try {
      const resolved = await withTimeout(1200, (signal) =>
        fetch(`${VIN_RESOLVER_URL}?lot_id=${encodeURIComponent(lotId)}`, { signal })
      ).then(r => r.ok ? r.json() : null);

      if (resolved) {
        vin = cleanStr(resolved.vin) || vin;
        odometer = cleanStr(resolved.odometer || resolved.odo || resolved.miles) || odometer;
        title = cleanStr(resolved.title || resolved.title_code) || title;
        seller = cleanStr(resolved.seller || resolved.seller_name) || seller;
      }
    } catch (_) {}
  }

  // odometer default (как ты сказала — пока 0)
  const odoNum = Number((odometer || "0").toString().replace(/[^\d]/g, "")) || 0;

  // 2) MMR bridge (когда подключим твой комп/расширение)
  let mmr = "";
  if (MMR_BRIDGE_URL && vin && !isMaskedVin(vin)) {
    try {
      const mmrResp = await withTimeout(1500, (signal) =>
        fetch(`${MMR_BRIDGE_URL}?vin=${encodeURIComponent(vin)}&odometer=${encodeURIComponent(String(odoNum))}`, { signal })
      ).then(r => r.ok ? r.json() : null);

      if (mmrResp && (mmrResp.mmr !== undefined)) {
        mmr = cleanStr(mmrResp.mmr);
      }
    } catch (_) {}
  }

  // Carfax link (если у тебя другой формат — скажешь, поменяем)
  const carfax = (vin && !isMaskedVin(vin))
    ? `https://www.carfax.com/VehicleHistory/p/Report.cfx?vin=${encodeURIComponent(vin)}`
    : "";

  // красиво собрать сообщение (даже если пока мало данных)
  const lines = [];
  lines.push(`⚡ NEW LOT (${source})`);
  if (lotId) lines.push(`Lot: ${lotId}`);
  if (price) lines.push(`Price: ${price}`);
  lines.push(`ODO: ${odoNum}${odometer ? "" : " (default 0)"}`);
  lines.push(`VIN: ${vin || "—"}`);
  lines.push(`MMR: ${mmr || "—"}`);
  if (title) lines.push(`Title: ${title}`);
  if (seller) lines.push(`Seller: ${seller}`);

  if (url) lines.push(`\n${url}`);
  if (carfax) lines.push(`${carfax}`);

  const text = lines.join("\n");

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

  return res.status(200).json({ ok: true });
}

