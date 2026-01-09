export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "POST only" });
    }

    // защита токеном из URL ?token=...
    const secret = req.query.token;
    if (process.env.WEBHOOK_SECRET && secret !== process.env.WEBHOOK_SECRET) {
      return res.status(401).json({ ok: false, error: "bad token" });
    }

    const body = req.body || {};

    // ---- RAW MODE (чтобы посмотреть "чистый" вебхук)
    // дерни: /api/hook?token=...&raw=1  (или поставь env RAW_ONLY=1)
    const rawOnly = req.query.raw === "1" || process.env.RAW_ONLY === "1";
    if (rawOnly) {
      await sendToTelegram({
        text: "RAW WEBHOOK:\n" + JSON.stringify(body, null, 2),
        botToken: process.env.BOT_TOKEN,
        chatId: process.env.CHAT_ID,
      });
      return res.status(200).json({ ok: true, raw: true });
    }

    // 1) достаем lot_id
    const lotId = String(body.lot_id || body.lotId || "").trim();
    if (!lotId) return res.status(200).json({ ok: true, skipped: true, reason: "NO_LOT_ID" });

    const copartUrl = body.url
      ? String(body.url)
      : `https://www.copart.com/lot/${encodeURIComponent(lotId)}`;

    // 2) VIN + ODO через твой Mac-bridge (Cloudflare tunnel)
    let vin = "";
    let odometer = "";

    if (process.env.VIN_RESOLVER_URL) {
      const vinUrl =
        `${process.env.VIN_RESOLVER_URL}` +
        `&lot_id=${encodeURIComponent(lotId)}`;

      const vinResp = await fetch(vinUrl);
      const vinJson = await vinResp.json();

      vin = vinJson?.vin || "";
      odometer = vinJson?.odometer || "";
    }

    // 3) Заголовок (год + марка + модель без комплектации)
    const title = buildTitleFromCopartUrl(copartUrl);

    // 4) Цена (old_bnp => bnp)
    const bnp = body.bnp;
    const oldBnp = body.old_bnp;
    const priceLine = buildPriceLine(oldBnp, bnp);

    // 5) Located: берем 2 буквы из yn (например "Mi - Detroit" => "MI")
    const located = extractState(body.yn);

    // 6) Seller/Name (если есть)
    const seller = body.scn ? String(body.scn).trim() : "";
    const sellerLine = seller ? `Name: ${seller}` : "";

    // 7) Title type (если есть)
    const stt = body.STT ? String(body.STT).trim() : "";
    const sttLine = stt ? `Title: ${stt}` : "";

    // 8) Carfax link (только если есть полный VIN)
    const carfaxUrl = vin ? `https://www.carfaxonline.com/vhr/${encodeURIComponent(vin)}` : "";

    // 9) Собираем текст (caption для фото)
    const lines = [
      `🚗 ${title}`,
      sellerLine,
      priceLine ? `Price: ${priceLine}` : "",
      located ? `Located: ${located}` : "",
      sttLine,
      vin ? `VIN: ${vin}` : "",
      odometer ? `Odo: ${odometer}` : "",
    ].filter(Boolean);

    const caption = lines.join("\n");

    // 10) Кнопки (CARFAX + Copart)
    const inlineKeyboard = {
      inline_keyboard: [
        [
          ...(carfaxUrl ? [{ text: "CARFAX", url: carfaxUrl }] : []),
          { text: "Copart", url: copartUrl },
        ],
      ],
    };

    // 11) Фото (если есть photo_url) иначе обычным сообщением
    const photoUrl = body.photo_url ? String(body.photo_url).trim() : "";

    if (photoUrl) {
      await sendPhotoToTelegram({
        photoUrl,
        caption,
        botToken: process.env.BOT_TOKEN,
        chatId: process.env.CHAT_ID,
        replyMarkup: inlineKeyboard,
      });
    } else {
      await sendToTelegram({
        text: caption,
        botToken: process.env.BOT_TOKEN,
        chatId: process.env.CHAT_ID,
        replyMarkup: inlineKeyboard,
      });
    }

    return res.status(200).json({ ok: true, lotId, vin, odometer });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
}

// ---------- helpers ----------

function buildTitleFromCopartUrl(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    const slug = parts[parts.length - 1] || "";
    // пример: clean-title-2019-dodge-charger-scat-pack-mi-detroit
    const tokens = slug.toLowerCase().split("-").filter(Boolean);

    // ищем год (4 цифры)
    const yearIdx = tokens.findIndex((t) => /^\d{4}$/.test(t));
    if (yearIdx === -1) return "LOT";

    const year = tokens[yearIdx];
    const make = tokens[yearIdx + 1] || "";
    const modelTokens = [];

    const stop = new Set([
      // частые комплектации/слова после модели
      "sv","s","se","sl","sr","le","xle","xse","lx","ex","exl","touring","sport",
      "limited","platinum","premium","lariat","xl","xlt","denali","rubicon",
      "scat","pack","scatpack","rt","srt","awd","fwd","rwd","4x4","4wd","2wd",
      "clean","title","salvage","rebuilt",
      // локации/мусор
      "mi","pa","la","ny","nj","tx","fl","ca","ga","il","az","nv","oh","wa","or"
    ]);

    // берем 1-3 токена модели, пока не упремся в stop
    for (let i = yearIdx + 2; i < tokens.length; i++) {
      const t = tokens[i];
      if (!t || stop.has(t)) break;
      modelTokens.push(t);
      if (modelTokens.length >= 2) break; // обычно хватает 2 (например grand cherokee)
    }

    const makeNice = make.toUpperCase();
    const modelNice = modelTokens.map((x) => x.toUpperCase()).join(" ");
    return `${year} ${makeNice}${modelNice ? " " + modelNice : ""}`.trim();
  } catch {
    return "LOT";
  }
}

function buildPriceLine(oldBnp, bnp) {
  const cur = toMoney(bnp);
  const old = toMoney(oldBnp);
  if (old && cur && old !== cur) return `${old} => ${cur}`;
  return cur || "";
}

function toMoney(v) {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  return "$" + Math.round(n).toLocaleString("en-US");
}

function extractState(yn) {
  if (!yn) return "";
  const s = String(yn).trim();
  // "Mi - Detroit" => "MI"
  const m = s.match(/^([A-Za-z]{2})\b/);
  return m ? m[1].toUpperCase() : "";
}

async function sendToTelegram({ text, botToken, chatId, replyMarkup }) {
  const tgUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
  await fetch(tgUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }),
  });
}

async function sendPhotoToTelegram({ photoUrl, caption, botToken, chatId, replyMarkup }) {
  const tgUrl = `https://api.telegram.org/bot${botToken}/sendPhoto`;
  await fetch(tgUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      photo: photoUrl,
      caption,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }),
  });
}
