export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });

    const secret = req.query.token;
    if (process.env.WEBHOOK_SECRET && secret !== process.env.WEBHOOK_SECRET) {
      return res.status(401).json({ ok: false, error: "bad token" });
    }

    const b = req.body || {};

    const source = b.source || "";
    const lotId = String(b.lot_id || b.lotId || "").trim();
    const copartUrl = b.url || (lotId ? `https://www.copart.com/lot/${lotId}` : "");
    const fv = String(b.fv || "").trim();          // может быть со звездочками
    const orr = b.orr;                              // пробег (приходит из вебхука)
    const ord = String(b.ord || "").trim();         // ACTUAL / NOT ACTUAL / ...
    const bnp = b.bnp;                              // текущая цена
    const old_bnp = b.old_bnp;                      // старая цена (если есть)
    const yard = String(b.yn || "").trim();         // "Mi - Detroit"
    const name = String(b.name || b.scn || "").trim(); // seller name если есть
    const photoUrl = String(b.photo_url || "").trim();

    if (!lotId) return res.status(200).json({ ok: true, skipped: true, reason: "NO_LOT_ID" });

    // ---- 1) VIN: если fv со звездочками - тянем полный VIN через твой мост
    let vin = "";
    const fvHasMask = fv.includes("*") || fv.length < 17;

    if (!fvHasMask && fv.length >= 11) {
      // иногда fv может быть полный уже
      vin = fv.replace(/\s+/g, "");
    } else {
      // берём полный VIN по lot_id
      const url = `${process.env.VIN_RESOLVER_URL}&lot_id=${encodeURIComponent(lotId)}`;
      const r = await fetch(url);
      const j = await r.json();
      vin = String(j?.vin || "").trim();
    }

    // ---- 2) Title: год + марка + модель из URL (без комплектации)
    // пример: /clean-title-2019-dodge-charger-scat-pack-mi-detroit
    function titleFromCopartUrl(u) {
      try {
        const path = new URL(u).pathname;
        const slug = path.split("/").filter(Boolean).pop() || "";
        // slug: clean-title-2019-dodge-charger-scat-pack-mi-detroit
        const parts = slug.split("-").filter(Boolean);

        // найдём первый 4-значный год
        const yi = parts.findIndex(p => /^\d{4}$/.test(p));
        if (yi === -1) return "";

        const year = parts[yi];
        const make = (parts[yi + 1] || "").toUpperCase();
        const model = (parts[yi + 2] || "").toUpperCase();
        if (!make || !model) return `${year}`;

        return `${year} ${make} ${model}`;
      } catch {
        return "";
      }
    }

    const title = titleFromCopartUrl(copartUrl) || `LOT ${lotId}`;

    // ---- 3) Price line
    const fmtMoney = (n) => {
      if (n === null || n === undefined || n === "") return "";
      const num = Number(n);
      if (Number.isNaN(num)) return String(n);
      return "$" + num.toLocaleString("en-US");
    };

    let priceLine = "";
    if (old_bnp !== undefined && old_bnp !== null && old_bnp !== "" && Number(old_bnp) > 0) {
      priceLine = `Price: ${fmtMoney(old_bnp)} => ${fmtMoney(bnp)}`;
    } else if (bnp !== undefined && bnp !== null && bnp !== "") {
      priceLine = `Price: ${fmtMoney(bnp)}`;
    }

    // ---- 4) Odometer line (из вебхука)
    let odoLine = "";
    if (orr !== undefined && orr !== null && orr !== "") {
      odoLine = `Odo: ${Number(orr).toLocaleString("en-US")}${ord ? ` (${ord})` : ""}`;
    } else if (ord) {
      odoLine = `Odo: (n/a) (${ord})`;
    }

    // ---- 5) Carfax link (короткая “кнопка” HTML-ссылкой)
    const carfaxUrl = vin ? `https://www.carfaxonline.com/vhr/${encodeURIComponent(vin)}` : "";

    // ---- 6) One message (caption)
    // HTML чтобы сделать компактно: "CARFAX" как ссылка
    const lines = [];
    lines.push(`🚗 <b>${escapeHtml(title)}</b>`);
    if (name) lines.push(`Name: ${escapeHtml(name)}`);
    if (priceLine) lines.push(escapeHtml(priceLine));
    if (yard) lines.push(`Located: ${escapeHtml(yard)}`);
    if (odoLine) lines.push(escapeHtml(odoLine));
    if (carfaxUrl) lines.push(`<a href="${carfaxUrl}">CARFAX</a>`);
    lines.push(`<a href="${copartUrl}">COPART LINK</a>`);
    if (source) lines.push(`Source: ${escapeHtml(source)}`);

    const caption = lines.join("\n");

    // ---- 7) Send to Telegram as ONE message with photo preview
    const tgMethod = photoUrl ? "sendPhoto" : "sendMessage";
    const tgUrl = `https://api.telegram.org/bot${process.env.BOT_TOKEN}/${tgMethod}`;

    const payload = photoUrl
      ? {
          chat_id: process.env.CHAT_ID,
          photo: photoUrl,
          caption,
          parse_mode: "HTML",
          disable_web_page_preview: true
        }
      : {
          chat_id: process.env.CHAT_ID,
          text: caption,
          parse_mode: "HTML",
          disable_web_page_preview: false
        };

    await fetch(tgUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    return res.status(200).json({ ok: true, lotId, vin, usedWebhookOdo: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
