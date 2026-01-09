export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });

    // token check
    const secret = req.query.token;
    if (process.env.WEBHOOK_SECRET && secret !== process.env.WEBHOOK_SECRET) {
      return res.status(401).json({ ok: false, error: "bad token" });
    }

    const body = req.body || {};

    // pretty JSON
    let text = "📩 WEBHOOK RAW\n\n" + JSON.stringify(body, null, 2);

    // Telegram limit ~4096 chars
    const TG_LIMIT = 3900;
    if (text.length > TG_LIMIT) {
      text =
        text.slice(0, TG_LIMIT) +
        "\n\n…(cut, too long for Telegram)";
    }

    const tgUrl = `https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`;
    await fetch(tgUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: process.env.CHAT_ID,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
}


