// pages/api/hook.js

function money(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return "";
  return Math.round(num).toLocaleString("en-US");
}

const STATE_SET = new Set([
  "al","ak","az","ar","ca","co","ct","de","fl","ga","hi","id","il","in","ia","ks","ky","la","me","md","ma","mi","mn","ms","mo",
  "mt","ne","nv","nh","nj","nm","ny","nc","nd","oh","ok","or","pa","ri","sc","sd","tn","tx","ut","vt","va","wa","wv","wi","wy",
  "dc"
]);

function extractFromCopartUrl(url) {
  // ожидаем что в url есть ".../clean-title-2021-ford-f150-super-cab-pa-..."
  // берём: year + make + model (первые 3 “смысловых” токена после года)
  if (!url || typeof url !== "string") return { year: "", make: "", model: "", state: "" };

  const m = url.match(/\/lot\/\d+\/([^?#]+)/i);
  const slug = m ? m[1] : "";

  const parts = slug
    .split("-")
    .map(s => (s || "").trim().toLowerCase())
    .filter(Boolean);

  // state: ищем токен из списка штатов
  let state = "";
  for (const p of parts) {
    if (STATE_SET.has(p)) { state = p.toUpperCase(); break; }
  }

  // year: ищем 4 цифры
  let yearIdx = -1;
  for (let i = 0; i < parts.length; i++) {
    if (/^\d{4}$/.test(parts[i])) { yearIdx = i; break; }
  }
  if (yearIdx === -1) return { year: "", make: "", model: "", state };

  const year = parts[yearIdx].toUpperCase();

  // make/model: берём следующие 2 токена после года
  // (по твоему правилу: год, марка, модель — без комплектации)
  const make = (parts[yearIdx + 1] || "").toUpperCase();
  const model = (parts[yearIdx + 2] || "").toUpperCase();

  return { year, make, model, state };
}

function buildPriceLine(oldBnp, bnp) {
  const hasNew = bnp !== "" && bnp !== null && bnp !== undefined;
  const hasOld = oldBnp !== "" && oldBnp !== null && oldBnp !== undefined;

  if (!hasNew && !hasOld) return "n/a";

  // если есть две цены
  if (hasOld && hasNew) {
    const oldNum = Number(oldBnp);
    const newNum = Number(bnp);

    let pct = "";
    if (Number.isFinite(oldNum) && Number.isFinite(newNum) && oldNum > 0) {
      const diff = oldNum - newNum;
      const p = (diff / oldNum) * 100;
      // показываем % только если реально уменьшили цену
      if (p > 0.05) pct = `  🔻 ${p.toFixed(1)}%`;
    }

    return `$${money(oldBnp)} => $${money(bnp)}${pct}`;
  }

  // иначе только новая
  if (hasNew) return `$${money(bnp)}`;
  return `$${money(oldBnp)}`;
}

async function tgSendPhoto({ botToken, chatId, photoUrl, caption, replyMarkup }) {
  const tgUrl = `https://api.telegram.org/bot${botToken}/sendPhoto`;
  const resp = await fetch(tgUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      photo: photoUrl,
      caption,
      parse_mode: "HTML",
      reply_markup: replyMarkup || undefined
    }),
  });
  const j = await resp.json().catch(() => ({}));
  return j;
}

async function tgSendMessage({ botToken, chatId, text, replyMarkup }) {
  const tgUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const resp = await fetch(tgUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: replyMarkup || undefined
    }),
  });
  const j = await resp.json().catch(() => ({}));
  return j;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });

    // защита токеном из URL ?token=...
    const secret = req.query.token;
    if (process.env.WEBHOOK_SECRET && secret !== process.env.WEBHOOK_SECRET) {
      return res.status(401).json({ ok: false, error: "bad token" });
    }

    const body = req.body || {};

    // основные поля от твоего вебхука
    const source = body.source || "";
    const lotId = String(body.lot_id ?? body.lotId ?? "");
    const url = body.url || (lotId ? `https://www.copart.com/lot/${lotId}` : "");
    const maskedVin = body.fv || "";
    const odo = body.orr ?? "";
    const odoRemark = body.ord || ""; // NOT ACTUAL и т.п.
    const bnp = body.bnp ?? "";
    const oldBnp = body.old_bnp ?? "";
    const locationText = body.yn || ""; // "Mi - Detroit" и т.п.
    const titleCode = body.STT || body.title || ""; // если появится
    const sellerName = (body.name || body.scn || "").toString().trim(); // если появится
    const photoUrl = (body.photo_url || "").toString().trim();
    const ts = body.ts ?? "";

    if (!lotId && !url) return res.status(200).json({ ok: true, skipped: true, reason: "NO_LOT" });

    // 1) Вытягиваем Year/Make/Model/State из url
    const { year, make, model, state } = extractFromCopartUrl(url);
    const carTitle = [year, make, model].filter(Boolean).join(" ").trim();

    // 2) Пробуем получить ПОЛНЫЙ VIN (если настроен VIN_RESOLVER_URL)
    // VIN_RESOLVER_URL пример:
    // https://forth-switch-accent-bingo.trycloudflare.com/resolveVin?token=copart123
    let fullVin = "";
    let resolvedOdo = "";
    if (process.env.VIN_RESOLVER_URL && lotId) {
      try {
        const vinUrl = `${process.env.VIN_RESOLVER_URL}&lot_id=${encodeURIComponent(lotId)}`;
        const vinResp = await fetch(vinUrl);
        const vinJson = await vinResp.json().catch(() => ({}));
        fullVin = (vinJson?.vin || "").toString();
        resolvedOdo = (vinJson?.odometer || "").toString();
      } catch (_) {}
    }

    // 3) Формируем ссылки
    const copartLink = url || `https://www.copart.com/lot/${lotId}`;
    const carfaxLink = fullVin ? `https://www.carfaxonline.com/vhr/${encodeURIComponent(fullVin)}` : "";

    // 4) Локация (пока просто PA / LA / и т.д.)
    // если state не нашли — покажем то что пришло (yn)
    const located = state || locationText || "n/a";

    // 5) Цена (с падением %)
    const priceLine = buildPriceLine(oldBnp, bnp);

    // 6) Caption (коротко и читабельно)
    // NOTE: caption у sendPhoto ограничен Telegram (лучше держать компактно)
    const lines = [];
    if (carTitle) lines.push(`🚗 <b>${carTitle}</b>`);
    else lines.push(`🚗 <b>NEW LOT</b>`);

    if (sellerName) lines.push(`Name: ${sellerName}`);

    // MMR пока не считаем — позже подключим (оставлю как "MMR: n/a")
    lines.push(`Price: ${priceLine} ( MMR n/a )`);

    lines.push(`Located: ${located}`);

    if (titleCode) lines.push(`Title: ${titleCode}`);

    // пробег/пометка пробега (если хочешь — можно выключить, скажешь)
    if (odo !== "" || odoRemark) {
      const odoText = odo !== "" ? `${money(odo)}` : (resolvedOdo ? resolvedOdo : "");
      const remark = odoRemark ? ` (${odoRemark})` : "";
      const show = (odoText || resolvedOdo) ? `${odoText || resolvedOdo}${remark}` : `${remark}`.trim();
      if (show) lines.push(`Odo: ${show}`);
    }

    // маленькая служебная метка от кого пришло (можно убрать)
    if (source) lines.push(`⚡ NEW LOT (${source})`);

    const caption = lines.join("\n");

    // 7) Кнопки (CARFAX / COPART)
    const replyMarkup = {
      inline_keyboard: [
        [
          ...(carfaxLink ? [{ text: "CARFAX", url: carfaxLink }] : []),
          { text: "COPART", url: copartLink },
        ],
      ],
    };

    // 8) Отправка в Telegram
    if (!process.env.BOT_TOKEN || !process.env.CHAT_ID) {
      return res.status(500).json({ ok: false, error: "BOT_TOKEN / CHAT_ID not set" });
    }

    let tgResult;
    if (photoUrl) {
      tgResult = await tgSendPhoto({
        botToken: process.env.BOT_TOKEN,
        chatId: process.env.CHAT_ID,
        photoUrl,
        caption,
        replyMarkup,
      });
    } else {
      // если фото нет — просто текст + кнопки
      const text = caption + (carfaxLink ? "" : "") + `\n${copartLink}`;
      tgResult = await tgSendMessage({
        botToken: process.env.BOT_TOKEN,
        chatId: process.env.CHAT_ID,
        text,
        replyMarkup,
      });
    }

    return res.status(200).json({
      ok: true,
      lotId,
      title: carTitle,
      state: located,
      maskedVin,
      fullVin,
      odo,
      odoRemark,
      ts,
      tgOk: tgResult?.ok ?? false
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
}
