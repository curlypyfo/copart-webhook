import json
import time
import base64
from pathlib import Path
import requests
import streamlit as st
import pandas as pd
import altair as alt
from datetime import datetime

SETTINGS_PATH = Path(__file__).resolve().parent / "ui_settings.json"

def load_ui_settings():
    if SETTINGS_PATH.exists():
        try:
            return json.loads(SETTINGS_PATH.read_text())
        except Exception:
            return {}
    return {}


def save_ui_settings(settings):
    SETTINGS_PATH.write_text(json.dumps(settings, ensure_ascii=False, indent=2))


def get_default_bridge_base_url():
    try:
        return st.secrets.get("BRIDGE_BASE_URL", "http://localhost:8789")
    except Exception:
        return "http://localhost:8789"


ui_settings = load_ui_settings()

if "bridge_base_url" not in st.session_state:
    st.session_state.bridge_base_url = ui_settings.get("bridge_base_url", get_default_bridge_base_url())
if "bridge_user" not in st.session_state:
    st.session_state.bridge_user = ""
if "bridge_pass" not in st.session_state:
    st.session_state.bridge_pass = ""
if "auth_ok" not in st.session_state:
    st.session_state.auth_ok = False

BRIDGE_BASE_URL = st.session_state.bridge_base_url


def auth_headers():
    creds = f"{st.session_state.bridge_user}:{st.session_state.bridge_pass}".encode("utf-8")
    token = base64.b64encode(creds).decode("utf-8")
    return {"Authorization": f"Basic {token}"}


def load_config():
    res = requests.get(f"{BRIDGE_BASE_URL}/config", headers=auth_headers(), timeout=5)
    res.raise_for_status()
    return res.json()


def save_config(config):
    res = requests.post(f"{BRIDGE_BASE_URL}/config", json=config, headers=auth_headers(), timeout=5)
    res.raise_for_status()


def load_history():
    res = requests.get(f"{BRIDGE_BASE_URL}/history", headers=auth_headers(), timeout=5)
    res.raise_for_status()
    return res.json()


def load_catalog():
    res = requests.get(f"{BRIDGE_BASE_URL}/catalog", headers=auth_headers(), timeout=5)
    res.raise_for_status()
    return res.json()


def load_terminal():
    res = requests.get(f"{BRIDGE_BASE_URL}/terminal", headers=auth_headers(), timeout=5)
    res.raise_for_status()
    return res.json()


def load_status():
    res = requests.get(f"{BRIDGE_BASE_URL}/status", headers=auth_headers(), timeout=5)
    res.raise_for_status()
    return res.json()


st.set_page_config(page_title="Copart Bridge UI", layout="wide")

st.title("Copart Bridge UI")

if not st.session_state.auth_ok:
    st.subheader("Вход")
    st.caption("Введите адрес Bridge и логин/пароль для доступа к API.")
    st.session_state.bridge_base_url = st.text_input(
        "Bridge URL",
        value=st.session_state.bridge_base_url,
        help="Например: https://bridge.lotnotify.com"
    )
    if st.button("Сохранить адрес Bridge"):
        ui_settings["bridge_base_url"] = st.session_state.bridge_base_url
        save_ui_settings(ui_settings)
        st.success("Адрес сохранен")
    st.session_state.bridge_user = st.text_input("Логин", value=st.session_state.bridge_user)
    st.session_state.bridge_pass = st.text_input("Пароль", type="password", value=st.session_state.bridge_pass)
    if st.button("Войти"):
        try:
            test_res = requests.get(
                f"{BRIDGE_BASE_URL}/config",
                headers=auth_headers(),
                timeout=5
            )
            if test_res.status_code == 200:
                st.session_state.auth_ok = True
                st.success("Доступ разрешен")
                st.rerun()
            else:
                st.error("Неверный логин или пароль")
        except Exception as exc:
            st.error(f"Не удалось подключиться к Bridge: {exc}")
    st.stop()

with st.sidebar:
    st.header("Профили")
    st.caption("Адрес Bridge")
    st.session_state.bridge_base_url = st.text_input(
        "Bridge URL",
        value=st.session_state.bridge_base_url,
        help="Например: http://192.168.0.25:8789"
    )
    if st.button("Сохранить адрес Bridge"):
        ui_settings["bridge_base_url"] = st.session_state.bridge_base_url
        save_ui_settings(ui_settings)
        st.success("Адрес сохранен")
    BRIDGE_BASE_URL = st.session_state.bridge_base_url
    config = load_config()
    profile_names = list(config.get("profiles", {}).keys())
    active_profile = config.get("active_profile", profile_names[0] if profile_names else "default")
    selected_profile = st.selectbox("Активный профиль", profile_names, index=profile_names.index(active_profile) if active_profile in profile_names else 0)
    if selected_profile != active_profile:
        config["active_profile"] = selected_profile
        save_config(config)
        st.success(f"Active profile set to {selected_profile}")

    st.divider()
    new_profile_name = st.text_input("Новый профиль")
    if st.button("Создать профиль") and new_profile_name:
        config.setdefault("profiles", {})[new_profile_name] = json.loads(json.dumps(config["profiles"][active_profile]))
        config["active_profile"] = new_profile_name
        save_config(config)
        st.success(f"Профиль создан: {new_profile_name}")

    delete_profile = st.selectbox("Удалить профиль", profile_names)
    if st.button("Удалить выбранный профиль") and delete_profile in config.get("profiles", {}):
        if len(config["profiles"]) <= 1:
            st.error("Нельзя удалить последний профиль")
        else:
            del config["profiles"][delete_profile]
            if config["active_profile"] == delete_profile:
                config["active_profile"] = list(config["profiles"].keys())[0]
            save_config(config)
            st.success("Профиль удалён")


config = load_config()
active_profile = config["active_profile"]
profile = config["profiles"][active_profile]

tabs = st.tabs(["📊 Логи", "🖥 Терминал", "🏁 Соревнование", "🧰 Фильтры", "💰 Экономика", "🚚 Доставка", "📁 История"])

with tabs[0]:

    status_payload = load_status()
    status = status_payload.get("status", {})
    status_cols = st.columns(4)
    bridge_up = status.get("bridgeStartedAt")
    last_lot = status.get("lastLotTs")
    ext = status.get("ext", {})
    ext_state = "Online" if ext.get("connected") else "Offline"
    status_cols[0].metric("Bridge", ext_state)
    status_cols[1].metric("Расширение", "Подключено" if ext.get("connected") else "Нет")
    if bridge_up:
        up_time = datetime.fromtimestamp(bridge_up / 1000).strftime("%H:%M:%S")
        status_cols[2].metric("Старт", up_time)
    if last_lot:
        last_lot_time = datetime.fromtimestamp(last_lot / 1000).strftime("%H:%M:%S")
        status_cols[3].metric("Последний лот", last_lot_time)

    st.caption("Статусы автологина по сайтам")
    site_status = status.get("sites", {})
    if site_status:
        status_rows = []
        for site, info in site_status.items():
            ts = info.get("ts")
            when = datetime.fromtimestamp(ts / 1000).strftime("%H:%M:%S") if ts else ""
            status_rows.append({
                "Сайт": site,
                "Статус": info.get("level"),
                "Сообщение": info.get("text"),
                "Время": when
            })
        st.dataframe(status_rows, use_container_width=True)
    else:
        st.info("Пока нет статусов автологина")

    col1, col2, col3 = st.columns(3)
    refresh_sec = col1.number_input("Обновление (сек)", min_value=1, max_value=30, value=3, help="Автообновление ленты")
    max_rows = col2.number_input("Сколько записей показывать", min_value=10, max_value=200, value=50)
    auto_refresh = col3.checkbox("Автообновление", value=True)

    history = load_history()
    recent = history[: int(max_rows)]

    stages = {}
    for entry in history:
        stage = entry.get("stage", "UNKNOWN")
        stages[stage] = stages.get(stage, 0) + 1

    today_start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    today_start_ms = int(today_start.timestamp() * 1000)
    today_history = [entry for entry in history if entry.get("ts") and entry.get("ts") >= today_start_ms]

    sent_count = sum(1 for entry in today_history if entry.get("stage") == "TG" and entry.get("status") == "SENT")
    skip_count = sum(1 for entry in today_history if entry.get("status") == "SKIP")

    bot_a_count = sum(1 for entry in history if entry.get("stage") == "RAW" and entry.get("source") == "botA")
    bot_b_count = sum(1 for entry in history if entry.get("stage") == "RAW" and entry.get("source") == "botB")

    first_source_by_lot = {}
    for entry in history:
        lot_id = entry.get("lotId")
        first_source = entry.get("firstSource")
        if lot_id and first_source and lot_id not in first_source_by_lot:
            first_source_by_lot[lot_id] = first_source

    bot_a_wins = sum(1 for src in first_source_by_lot.values() if src == "botA")
    bot_b_wins = sum(1 for src in first_source_by_lot.values() if src == "botB")

    
    st.markdown(
        f"""
        <style>
        .compact-metrics {{
            display: flex;
            gap: 12px;
            align-items: center;
            justify-content: flex-start;
        }}
        .metric-card {{
            border-radius: 10px;
            padding: 10px 14px;
            background: #f7f7f7;
            min-width: 160px;
        }}
        .metric-title {{
            font-size: 12px;
            color: #6b7280;
            margin-bottom: 2px;
        }}
        .metric-value {{
            font-size: 26px;
            font-weight: 700;
            line-height: 1.1;
        }}
        .metric-sent {{ color: #1f9d55; }}
        .metric-skip {{ color: #d64545; }}
        </style>
        <div class="compact-metrics">
            <div class="metric-card">
                <div class="metric-title">Отправлено в ТГ</div>
                <div class="metric-value metric-sent">{sent_count}</div>
            </div>
            <div class="metric-card">
                <div class="metric-title">SKIP</div>
                <div class="metric-value metric-skip">{skip_count}</div>
            </div>
        </div>
        """,
        unsafe_allow_html=True
    )

    st.write("### Логи")

    def is_final(entry):
        stage = entry.get("stage", "")
        status = entry.get("status", "")
        if stage == "TG" and status == "SENT":
            return True
        if status == "SKIP":
            return True
        if stage == "DEDUP" and status == "DUPLICATE":
            return True
        return False

    final_entries = []
    seen = set()
    for entry in history:
        lot_id = entry.get("lotId")
        if not lot_id or lot_id in seen:
            continue
        if is_final(entry):
            final_entries.append(entry)
            seen.add(lot_id)

    for entry in history:
        lot_id = entry.get("lotId")
        if not lot_id or lot_id in seen:
            continue
        final_entries.append(entry)
        seen.add(lot_id)

    for entry in final_entries[: int(max_rows)]:
        ts = entry.get("ts")
        when = datetime.fromtimestamp(ts / 1000).strftime("%H:%M:%S") if ts else ""
        lot_id = entry.get("lotId")
        stage = entry.get("stage", "")
        status = entry.get("status", "")
        title = entry.get("title") or entry.get("lotId")
        reason = entry.get("reason", "")
        photo = entry.get("photo", "")
        url = entry.get("url", "")
        primary_damage = entry.get("dd", "")
        secondary_damage = entry.get("sdd", "")
        seller = entry.get("seller", "")
        state = entry.get("state", "")
        price = entry.get("price")
        mmr = entry.get("mmr")
        vin = entry.get("vin", "")
        delivery = entry.get("delivery")
        car_fix = entry.get("carFix")
        mileage = entry.get("mileage")
        mileage_status = entry.get("mileageStatus")

        if stage == "TG" and status == "SENT":
            outcome = "SENT ✅"
        elif status == "SKIP":
            outcome = "SKIP ❌"
        elif stage == "DEDUP" and status == "DUPLICATE":
            outcome = "DUPLICATE ⚠️"
        else:
            outcome = f"{stage} {status}".strip()

        header = f"{when} | LOT {lot_id} | {outcome}"
        st.markdown(f"**{header}**")
        cols = st.columns([1, 3])
        with cols[0]:
            if photo:
                st.image(photo, use_container_width=True)
            elif url:
                st.markdown(f"[Открыть лот]({url})")
        with cols[1]:
            st.write(title)
            info_lines = []
            if seller:
                info_lines.append(f"Seller: {seller}")
            if state:
                info_lines.append(f"State: {state}")
            if mileage is not None:
                mileage_display = f"{mileage:,}" if isinstance(mileage, (int, float)) else str(mileage)
                if mileage_status:
                    mileage_display = f"{mileage_display} ({mileage_status})"
                info_lines.append(f"Mileage: {mileage_display}")
            if price is not None:
                info_lines.append(f"Price: ${int(price):,}")
            if mmr is not None:
                info_lines.append(f"MMR: ${int(mmr):,}")
            if vin:
                info_lines.append(f"VIN: {vin}")
            if delivery is not None:
                info_lines.append(f"Delivery: ${int(delivery):,}")
            if car_fix is not None:
                info_lines.append(f"CAR+FIX: ${int(car_fix):,}")
            if primary_damage or secondary_damage:
                dd_line = primary_damage if primary_damage else "—"
                sdd_line = secondary_damage if secondary_damage else "—"
                info_lines.append(f"Damage: {dd_line}, {sdd_line}")

            if info_lines:
                st.text("\n".join(info_lines))
            if reason:
                st.caption(f"Причина: {reason}")
            if url:
                st.markdown(f"[Открыть лот]({url})")
        st.divider()


with tabs[1]:
    st.subheader("Терминал")
    terminal_logs = load_terminal()
    if terminal_logs:
        terminal_rows = []
        for item in terminal_logs:
            ts = item.get("ts")
            when = datetime.fromtimestamp(ts / 1000).strftime("%H:%M:%S") if ts else ""
            terminal_rows.append({
                "Время": when,
                "Уровень": item.get("level", "info"),
                "Сообщение": item.get("message", "")
            })
        st.dataframe(terminal_rows, use_container_width=True)
    else:
        st.info("Логи терминала пока пустые")


with tabs[2]:
    st.subheader("Соревнование BotA vs BotB")

    if "competition_reset_ts" not in st.session_state:
        st.session_state.competition_reset_ts = None

    if st.button("Сбросить счетчики соревнования"):
        st.session_state.competition_reset_ts = time.time()
        st.success("Счетчики соревнования сброшены")

    reset_ts = st.session_state.competition_reset_ts
    if reset_ts:
        history_for_comp = [entry for entry in history if entry.get("ts") and entry.get("ts") >= reset_ts * 1000]
        st.caption(f"Считаем только лоты после сброса: {datetime.fromtimestamp(reset_ts).strftime('%Y-%m-%d %H:%M:%S')}")
    else:
        history_for_comp = history
        st.caption("Считаем все лоты (без фильтра по времени)")

    comp_bot_a_count = sum(1 for entry in history_for_comp if entry.get("stage") == "RAW" and entry.get("source") == "botA")
    comp_bot_b_count = sum(1 for entry in history_for_comp if entry.get("stage") == "RAW" and entry.get("source") == "botB")

    comp_first_source_by_lot = {}
    for entry in history_for_comp:
        lot_id = entry.get("lotId")
        first_source = entry.get("firstSource")
        if lot_id and first_source and lot_id not in comp_first_source_by_lot:
            comp_first_source_by_lot[lot_id] = first_source

    comp_bot_a_wins = sum(1 for src in comp_first_source_by_lot.values() if src == "botA")
    comp_bot_b_wins = sum(1 for src in comp_first_source_by_lot.values() if src == "botB")

    comp_cols = st.columns(4)
    comp_cols[0].metric("BotA прислал", comp_bot_a_count)
    comp_cols[1].metric("BotB прислал", comp_bot_b_count)
    comp_cols[2].metric("BotA выиграл", comp_bot_a_wins)
    comp_cols[3].metric("BotB выиграл", comp_bot_b_wins)

    st.write("### График соревнования")
    chart_df = pd.DataFrame(
        [
            {"Метрика": "Прислали", "Бот": "BotA", "Значение": comp_bot_a_count},
            {"Метрика": "Прислали", "Бот": "BotB", "Значение": comp_bot_b_count},
            {"Метрика": "Выиграли", "Бот": "BotA", "Значение": comp_bot_a_wins},
            {"Метрика": "Выиграли", "Бот": "BotB", "Значение": comp_bot_b_wins},
        ]
    )

    bar = (
        alt.Chart(chart_df)
        .mark_bar()
        .encode(
            x=alt.X("Метрика:N", title=""),
            y=alt.Y("Значение:Q", title=""),
            color=alt.Color(
                "Бот:N",
                scale=alt.Scale(domain=["BotA", "BotB"], range=["#3B82F6", "#F97316"])
            ),
            xOffset="Бот:N",
            tooltip=["Бот", "Метрика", "Значение"]
        )
    )

    labels = (
        alt.Chart(chart_df)
        .mark_text(dy=-8, size=12)
        .encode(
            x=alt.X("Метрика:N", title=""),
            y=alt.Y("Значение:Q", title=""),
            text=alt.Text("Значение:Q"),
            xOffset="Бот:N"
        )
    )

    st.altair_chart(bar + labels, use_container_width=True)

with tabs[3]:
    st.subheader("Фильтры")
    filters = profile.setdefault("filters", {})
    catalog = load_catalog()

    st.markdown("### 🧱 Черный список")
    st.caption("Выбирай элементы — они сразу сохраняются. Чтобы удалить, просто убери из списка.")
    filters["blocked_title_types"] = st.multiselect(
        "Тайтлы",
        options=sorted(catalog.get("title_types", [])),
        default=filters.get("blocked_title_types", []),
    )
    filters["blocked_primary_damage"] = st.multiselect(
        "Основные повреждения (dd)",
        options=sorted(catalog.get("primary_damage", [])),
        default=filters.get("blocked_primary_damage", []),
    )
    filters["blocked_secondary_damage"] = st.multiselect(
        "Доп. повреждения (sdd)",
        options=sorted(catalog.get("secondary_damage", [])),
        default=filters.get("blocked_secondary_damage", []),
    )
    filters["blocked_states"] = st.multiselect(
        "Штаты",
        options=sorted([s for s in catalog.get("states", []) if s not in filters.get("require_seller_states", [])]),
        default=[s for s in filters.get("blocked_states", []) if s not in filters.get("require_seller_states", [])],
    )
    filters["blocked_mileage_status"] = st.multiselect(
        "Пробег",
        options=sorted(catalog.get("mileage_status", [])),
        default=filters.get("blocked_mileage_status", []),
    )
    filters["blocked_sources"] = st.multiselect(
        "Источники",
        options=sorted(catalog.get("sources", [])),
        default=filters.get("blocked_sources", []),
    )
    filters["blocked_sellers"] = st.multiselect(
        "Продавцы",
        options=sorted(catalog.get("sellers", [])),
        default=filters.get("blocked_sellers", []),
    )

    st.markdown("---")
    st.markdown("### ⚙️ Логические правила")

    col1, col2 = st.columns(2)
    with col1:
        require_actual = st.checkbox("Только ACTUAL пробег", value=filters.get("mileage", {}).get("require_actual", True), help="Если выключить — будут проходить все типы пробега")
        allow_zero_fl = st.checkbox("Разрешить исключение для FL = 0", value=filters.get("mileage", {}).get("allow_zero_fl", True), help="Используется для FL с нулевым пробегом")
        filters["mileage"] = {"require_actual": require_actual, "allow_zero_fl": allow_zero_fl}

    with col2:
        bad_titles = st.text_area("Плохие тайтлы (через запятую)", ",".join(filters.get("bad_titles", [])), help="Например: RT, RS, LQ")
        bad_states = st.text_area("Плохие штаты (через запятую)", ",".join(filters.get("bad_states", [])), help="Например: WI, AK")
        filters["bad_titles"] = [x.strip().upper() for x in bad_titles.split(",") if x.strip()]
        filters["bad_states"] = [x.strip().upper() for x in bad_states.split(",") if x.strip()]

    seller_blacklist = st.text_area("Черный список продавцов (через запятую)", ",".join(filters.get("seller_blacklist", [])), help="Пример: insurance, progressive")
    hidden_sellers = st.text_area("Штаты со скрытым продавцом (через запятую)", ",".join(filters.get("hidden_seller_states", [])), help="Пример: TX, MI, TN")
    filters["seller_blacklist"] = [x.strip().lower() for x in seller_blacklist.split(",") if x.strip()]
    filters["hidden_seller_states"] = [x.strip().upper() for x in hidden_sellers.split(",") if x.strip()]

    require_seller_states = st.text_area(
        "Штаты, где продавец обязателен (через запятую)",
        ",".join(filters.get("require_seller_states", [])),
        help="Если продавца нет или он в черном списке — лот будет скрыт"
    )
    filters["require_seller_states"] = [x.strip().upper() for x in require_seller_states.split(",") if x.strip()]
    filters["blocked_states"] = [s for s in filters.get("blocked_states", []) if s not in filters["require_seller_states"]]

    config["profiles"][active_profile] = profile
    save_config(config)
    st.caption("Автосохранение включено")

with tabs[4]:
    st.subheader("Экономика")
    economics = profile.setdefault("economics", {})
    economics["mmr_multiplier"] = st.number_input("Множитель MMR", value=float(economics.get("mmr_multiplier", 0.97)), help="MMR * множитель")
    economics["fixed_costs"] = st.number_input("Фиксированные расходы", value=int(economics.get("fixed_costs", 1300)))
    economics["repair_cost"] = st.number_input("Ремонт", value=int(economics.get("repair_cost", 3000)))
    economics["profit_buffer"] = st.number_input("Запас прибыли", value=int(economics.get("profit_buffer", 1000)))

    config["profiles"][active_profile] = profile
    save_config(config)
    st.caption("Автосохранение включено")

with tabs[5]:
    st.subheader("Доставка")
    st.caption("Расчет доставки: если город в исключениях — берём фиксированную цену. Иначе считаем расстояние по штату, умножаем на коэффициент и округляем. Минимум $350.")
    st.markdown("**Доставка в Орландо.**")
    st.markdown(
        """
        **Формула:**
        - Воздушное расстояние → умножаем на **1.2** (приблизительная дорога)
        - `Цена = дистанция × коэффициент доставки`
        - Округление: `< 600` → до 50, `≥ 600` → до 100
        - Минимальная цена: **$350**
        """
    )
    delivery = profile.setdefault("delivery", {})
    delivery["delivery_multiplier"] = st.number_input(
        "Коэффициент доставки",
        value=float(delivery.get("delivery_multiplier", 0.75)),
        help="Коэффициент по расстоянию"
    )

    fixed = delivery.setdefault("fixed", {})
    st.caption("Исключения по городам (фиксированная цена/дистанция)")
    fixed_rows = [
        {"Город": city, "Цена": data.get("price", 0), "Дистанция": data.get("dist", 0)}
        for city, data in fixed.items()
    ]
    edited_rows = st.data_editor(
        fixed_rows,
        use_container_width=True,
        num_rows="dynamic",
        column_config={
            "Город": st.column_config.TextColumn(help="Например: ORLANDO, MIAMI"),
            "Цена": st.column_config.NumberColumn(min_value=0),
            "Дистанция": st.column_config.NumberColumn(min_value=0)
        },
    )
    new_fixed = {}
    for row in edited_rows:
        city = str(row.get("Город", "")).strip().upper()
        if not city:
            continue
        new_fixed[city] = {
            "price": int(row.get("Цена") or 0),
            "dist": int(row.get("Дистанция") or 0)
        }
    delivery["fixed"] = new_fixed
    config["profiles"][active_profile] = profile
    save_config(config)
    st.caption("Автосохранение включено")

with tabs[6]:
    st.subheader("История")
    history = load_history()
    if history:
        st.dataframe(history, use_container_width=True)
    else:
        st.info("История пустая")

if auto_refresh:
    time.sleep(float(refresh_sec))
    if hasattr(st, "rerun"):
        st.rerun()
    else:
        st.experimental_rerun()