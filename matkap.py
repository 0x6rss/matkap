import requests
import tkinter as tk
import tkinter.ttk as ttk
import asyncio
import os
import threading
from tkinter import messagebox
from tkinter.scrolledtext import ScrolledText
from telethon import TelegramClient
from dotenv import load_dotenv

import fofa_api
import urlscan_api  

try:
    from PIL import Image, ImageTk
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False

load_dotenv()

env_api_id = os.getenv("TELEGRAM_API_ID", "0")
env_api_hash = os.getenv("TELEGRAM_API_HASH", "")
env_phone_number = os.getenv("TELEGRAM_PHONE", "")

api_id = int(env_api_id) if env_api_id.isdigit() else 0
api_hash = env_api_hash
phone_number = env_phone_number

client = TelegramClient("anon_session", api_id, api_hash, app_version="9.4.0")

TELEGRAM_API_URL = "https://api.telegram.org/bot"

class ToolTip:
    def __init__(self, widget, text):
        self.widget = widget
        self.text = text
        self.tip_window = None
        self.show_id = None

        self.widget.bind("<Enter>", self.schedule_show)
        self.widget.bind("<Leave>", self.hide_tip)
        self.widget.bind("<Motion>", self.reset_schedule)  # optional, reset delay on mouse move

    def schedule_show(self, event=None):
        # Schedule tooltip show after 250ms
        self.cancel_scheduled()
        self.show_id = self.widget.after(250, self.show_tip)

    def reset_schedule(self, event=None):
        # Reset tooltip delay if mouse is moving inside widget
        self.schedule_show()

    def cancel_scheduled(self):
        if self.show_id:
            self.widget.after_cancel(self.show_id)
            self.show_id = None

    def show_tip(self, event=None):
        self.cancel_scheduled()
        if self.tip_window or not self.text:
            return

        # Position tooltip just below the widget
        x = self.widget.winfo_rootx()
        y = self.widget.winfo_rooty() + self.widget.winfo_height()

        screen_width = self.widget.winfo_screenwidth()
        screen_height = self.widget.winfo_screenheight()

        self.tip_window = tw = tk.Toplevel(self.widget)
        tw.wm_overrideredirect(True)
        tw.wm_attributes("-topmost", True)  # keep tooltip on top

        label = tk.Label(
            tw, text=self.text, justify="left",
            background="#ffffe0", relief="solid", borderwidth=1,
            font=("tahoma", "10", "normal")
        )
        label.pack(ipadx=1)

        tw.update_idletasks()
        tip_width = tw.winfo_width()
        tip_height = tw.winfo_height()

        # Adjust position to keep tooltip inside screen
        if x + tip_width > screen_width:
            x = screen_width - tip_width - 10
        if y + tip_height > screen_height:
            y = screen_height - tip_height - 10

        tw.wm_geometry(f"+{x}+{y}")

    def hide_tip(self, event=None):
        self.cancel_scheduled()
        if self.tip_window:
            self.tip_window.destroy()
            self.tip_window = None

class TelegramGUI:
    def __init__(self, root):
        self.root = root
        self.root.title("Matkap by 0x6rss")
        self.root.geometry("1300x700")  
        self.root.resizable(True, True)

        self.themes = {
            "Light": {
                "bg": "#FFFFFF",
                "fg": "#000000",
                "header_bg": "#AAAAAA",
                "main_bg": "#FFFFFF"
            },
            "Dark": {
                "bg": "#2E2E2E",
                "fg": "#FFFFFF",
                "header_bg": "#333333",
                "main_bg": "#2E2E2E"
            }
        }
        self.current_theme = "Light"
        self.style = ttk.Style()
        self.style.theme_use("clam")
        self.configure_theme(self.current_theme)

        self.style.configure(
            "Fofa.TButton",
            background="#000080",  
            foreground="#ADD8E6", 
        )

        self.style.configure("TLabel", background="#D9D9D9", foreground="black")
        self.style.configure("TButton", background="#E1E1E1", foreground="black")
        self.style.configure("TLabelframe", background="#C9C9C9", foreground="black")
        self.style.configure("TLabelframe.Label", font=("Arial", 11, "bold"))
        self.style.configure("TEntry", fieldbackground="#FFFFFF", foreground="black")

        self.header_frame = tk.Frame(self.root, bg=self.themes[self.current_theme]["header_bg"])
        self.header_frame.grid(row=0, column=0, columnspan=6, sticky="ew")
        self.header_frame.grid_columnconfigure(1, weight=1)

        self.logo_image = None
        script_dir = os.path.dirname(os.path.abspath(__file__))
        logo_path = os.path.join(script_dir, "logo.png")
        if os.path.isfile(logo_path):
            try:
                if PIL_AVAILABLE:
                    pil_img = Image.open(logo_path)
                    self.logo_image = ImageTk.PhotoImage(pil_img)
                else:
                    self.logo_image = tk.PhotoImage(file=logo_path)
            except Exception as e:
                print("Logo load error:", e)
                self.logo_image = None

        self.header_label = tk.Label(
            self.header_frame,
            text="Matkap - hunt down malicious telegram bots",
            font=("Arial", 16, "bold"),
            bg=self.themes[self.current_theme]["header_bg"],
            fg=self.themes[self.current_theme]["fg"],
            image=self.logo_image,
            compound="left",
            padx=10
        )
        self.header_label.grid(row=0, column=0, sticky="w", padx=5, pady=5)

        self.main_frame = tk.Frame(
            self.root,
            bg=self.themes[self.current_theme]["main_bg"],
            highlightthickness=2,
            bd=0,
            relief="groove"
        )
        self.main_frame.grid(row=1, column=0, columnspan=6, sticky="nsew", padx=10, pady=10)
        self.root.grid_rowconfigure(1, weight=1)
        self.root.grid_columnconfigure(0, weight=1)

        ttk.Label(self.main_frame, text="Color Theme:").grid(row=0, column=2, sticky="e", padx=5, pady=5)
        self.theme_combo = ttk.Combobox(self.main_frame, values=list(self.themes.keys()), state="readonly")
        self.theme_combo.current(0)
        self.theme_combo.grid(row=0, column=3, padx=5, pady=5, sticky="ew")
        self.theme_combo.bind("<<ComboboxSelected>>", self.switch_theme)

        self.token_label = ttk.Label(self.main_frame, text="Malicious Bot Token:")
        self.token_label.grid(row=1, column=0, sticky="w", padx=5, pady=5)
        self.token_entry = ttk.Entry(self.main_frame, width=45)
        self.token_entry.grid(row=1, column=1, padx=5, pady=5, sticky="ew")
        self.add_placeholder(self.token_entry, "Example: bot12345678:AsHy7q9QB755Lx4owv76xjLqZwHDcFf7CSE")
        ToolTip(self.token_entry, "Paste the full Telegram bot token here.")

        self.chat_label = ttk.Label(self.main_frame, text="Malicious Chat ID (Forward):")
        self.chat_label.grid(row=2, column=0, sticky="w", padx=5, pady=5)
        self.chatid_entry = ttk.Entry(self.main_frame, width=45)
        self.chatid_entry.grid(row=2, column=1, padx=5, pady=5, sticky="ew")
        self.add_placeholder(self.chatid_entry, "Example: 123456789")
        ToolTip(self.chatid_entry, "Paste the malicious chat ID here.")

        self.infiltrate_button = ttk.Button(
            self.main_frame,
            text="1) Start Attack",
            command=self.start_infiltration
        )
        self.infiltrate_button.grid(row=3, column=0, padx=5, pady=5, sticky="w")
        ToolTip(self.infiltrate_button, "Starts the infiltration process using bot token.")

        self.forward_button = ttk.Button(
            self.main_frame,
            text="2) Forward All Messages",
            command=self.forward_all_messages
        )
        self.forward_button.grid(row=3, column=1, padx=5, pady=5, sticky="w")
        ToolTip(self.forward_button, "Tries to forward all messages from attacker chat.")

        self.stop_button = ttk.Button(
            self.main_frame,
            text="Stop",
            command=self.stop_forwarding
        )
        self.stop_button.grid(row=3, column=2, padx=5, pady=5, sticky="w")
        ToolTip(self.stop_button, "Stops the current forwarding operation.")

        self.resume_button = ttk.Button(
            self.main_frame,
            text="Continue",
            command=self.resume_forward,
            state="disabled"
        )
        self.resume_button.grid(row=3, column=3, padx=5, pady=5, sticky="w")
        ToolTip(self.resume_button, "Resume forwarding from where it stopped.")

        self.fofa_button = ttk.Button(
            self.main_frame,
            text="3) Hunt With FOFA",
            style="Fofa.TButton",
            command=self.run_fofa_hunt
        )
        self.fofa_button.grid(row=3, column=4, padx=5, pady=5, sticky="w")
        ToolTip(self.fofa_button, "Scan for leaked bot tokens/chat IDs via FOFA API.")

        self.urlscan_button = ttk.Button(
            self.main_frame,
            text="4) Hunt With URLScan",
            style="Fofa.TButton",
            command=self.run_urlscan_hunt
        )
        self.urlscan_button.grid(row=3, column=5, padx=5, pady=5, sticky="w")
        ToolTip(self.urlscan_button, "Scan for leaked bot tokens/chat IDs via URLScan.")

        self.log_frame = ttk.LabelFrame(self.main_frame, text="Process Log")
        self.log_frame.grid(row=4, column=0, columnspan=6, sticky="nsew", padx=5, pady=5)
        self.main_frame.grid_rowconfigure(4, weight=1)
        self.main_frame.grid_columnconfigure(1, weight=1)

        self.log_text = ScrolledText(self.log_frame, width=75, height=15, state="disabled")
        self.log_text.pack(fill="both", expand=True, padx=5, pady=5)

        self.log_text.tag_config("token_tag", font=("Arial", 10, "bold italic"), foreground="black")
        self.log_text.tag_config("chatid_tag", font=("Arial", 10, "bold italic"), foreground="black")

        clear_logs_btn = ttk.Button(self.log_frame, text="Clear Logs", command=self.clear_logs)
        clear_logs_btn.pack(side="right", anchor="e", pady=5)
        ToolTip(clear_logs_btn, "Clear the current log messages from the log panel.")

        export_logs_btn = ttk.Button(self.log_frame, text="Export Logs", command=self.export_logs)
        export_logs_btn.pack(side="right", anchor="e", padx=5, pady=5)
        ToolTip(export_logs_btn, "Exports the logs into a .txt file.")

        self.bot_token = None
        self.bot_username = None
        self.my_chat_id = None
        self.last_message_id = None
        self.stop_flag = False
        self.stopped_id = 0
        self.current_msg_id = 0
        self.max_older_attempts = 200
        self.session = requests.Session()
        # Skipping + failure tracking
        self.skip_seen_messages = True
        self.failed_400_ids = []  # list of IDs that returned HTTP 400
        self.missing_ids = set()  # set of IDs already recorded as missing (400)

        # UI: checkbox to toggle skipping
        self.skip_var = tk.BooleanVar(value=True)
        self.skip_checkbox = ttk.Checkbutton(
            self.main_frame,
            text="Skip Seen Messages",
            variable=self.skip_var,
            command=self.on_toggle_skip
        )
        # Place near theme selector row=0 if space; column 4 seems free
        self.skip_checkbox.grid(row=0, column=4, padx=5, pady=5, sticky="w")


    def export_logs(self):
        logs = self.log_text.get("1.0", "end")
        try:
            with open("logs.txt", "w", encoding="utf-8") as f:
                f.write(logs)
            messagebox.showinfo("Export Logs", "Logs have been exported to 'logs.txt'.")
        except Exception as e:
            messagebox.showerror("Export Error", f"Failed to export logs!\n{e}")

    def run_fofa_hunt(self):
        thread = threading.Thread(target=self._fofa_hunt_process)
        thread.start()

    def _fofa_hunt_process(self):
        self.log("🔎 Starting FOFA hunt for body='api.telegram.org' ...")
        results = fofa_api.search_fofa_and_hunt()
        if not results:
            self.log("⚠️ No FOFA results or an error occurred!")
            return
        for (site_or_err, tokens, chats) in results:
            if site_or_err.startswith("Error") or site_or_err.startswith("FOFA"):
                self.log(f"🚫 {site_or_err}")
                continue
            if site_or_err.startswith("No results"):
                self.log("⚠️ No FOFA results found.")
                continue
            self.log(f"✨ Found: {site_or_err}")
            if tokens:
                self.log_text.configure(state="normal")
                self.log_text.insert("end", "   🪄 Tokens: ")
                for i, token in enumerate(tokens):
                    self.log_text.insert("end", token, "token_tag")
                    if i < len(tokens) - 1:
                        self.log_text.insert("end", ", ")
                self.log_text.insert("end", "\n")
                self.log_text.configure(state="disabled")
            if chats:
                self.log_text.configure(state="normal")
                self.log_text.insert("end", "   Potential Chat IDs: ")
                for i, chatid in enumerate(chats):
                    self.log_text.insert("end", chatid, "chatid_tag")
                    if i < len(chats) - 1:
                        self.log_text.insert("end", ", ")
                self.log_text.insert("end", "\n")
                self.log_text.configure(state="disabled")
        self.log("📝 FOFA hunt finished.")

    def run_urlscan_hunt(self):
        thread = threading.Thread(target=self._urlscan_hunt_process)
        thread.start()

    def _urlscan_hunt_process(self):
        self.log("🔎 Starting URLScan hunt for domain:api.telegram.org ...")
        results = urlscan_api.search_urlscan_and_hunt()
        if not results:
            self.log("⚠️ No URLScan results or an error occurred!")
            return
        for (site_or_err, tokens, chats) in results:
            if site_or_err.startswith("Error"):
                self.log(f"🚫 {site_or_err}")
                continue
            if site_or_err.startswith("No results"):
                self.log("⚠️ No URLScan results found.")
                continue
            self.log(f"✨ Found: {site_or_err}")
            if tokens:
                self.log_text.configure(state="normal")
                self.log_text.insert("end", "   🪄 Tokens: ")
                for i, token in enumerate(tokens):
                    self.log_text.insert("end", token, "token_tag")
                    if i < len(tokens) - 1:
                        self.log_text.insert("end", ", ")
                self.log_text.insert("end", "\n")
                self.log_text.configure(state="disabled")
            if chats:
                self.log_text.configure(state="normal")
                self.log_text.insert("end", "   Potential Chat IDs: ")
                for i, chatid in enumerate(chats):
                    self.log_text.insert("end", chatid, "chatid_tag")
                    if i < len(chats) - 1:
                        self.log_text.insert("end", ", ")
                self.log_text.insert("end", "\n")
                self.log_text.configure(state="disabled")
        self.log("📝 URLScan hunt finished.")

    def configure_theme(self, theme_name):
        theme_info = self.themes[theme_name]
        bg = theme_info["bg"]
        fg = theme_info["fg"]
        self.style.configure(".", background=bg, foreground=fg)
        self.style.configure("TLabel", background=bg, foreground=fg)
        self.style.configure("TButton", background=bg, foreground=fg)
        self.style.configure("TLabelframe", background=bg, foreground=fg)
        self.style.configure("TLabelframe.Label", background=bg, foreground=fg)
        self.style.configure("TEntry", fieldbackground="#FFFFFF", foreground="#000000")

    def switch_theme(self, event):
        selected_theme = self.theme_combo.get()
        if selected_theme in self.themes:
            self.current_theme = selected_theme
            self.configure_theme(selected_theme)
            self.header_frame.config(bg=self.themes[self.current_theme]["header_bg"])
            self.header_label.config(bg=self.themes[self.current_theme]["header_bg"],
                                     fg=self.themes[self.current_theme]["fg"])
            self.main_frame.config(bg=self.themes[self.current_theme]["main_bg"])
            self.log(f"🌀 Switched theme to: {selected_theme}")

    def clear_logs(self):
        self.log_text.configure(state="normal")
        self.log_text.delete("1.0", "end")
        self.log_text.configure(state="disabled")

    def add_placeholder(self, entry_widget, placeholder_text):
        def on_focus_in(event):
            if entry_widget.get() == placeholder_text:
                entry_widget.delete(0, "end")
                entry_widget.configure(foreground="black")
        def on_focus_out(event):
            if entry_widget.get().strip() == "":
                entry_widget.insert(0, placeholder_text)
                entry_widget.configure(foreground="grey")
        entry_widget.insert(0, placeholder_text)
        entry_widget.configure(foreground="grey")
        entry_widget.bind("<FocusIn>", on_focus_in)
        entry_widget.bind("<FocusOut>", on_focus_out)

    def log(self, message):
        self.log_text.configure(state="normal")
        self.log_text.insert("end", message + "\n")
        self.log_text.see("end")
        self.log_text.configure(state="disabled")

    # ===================== Skip / Seen Messages Helpers =====================
    def on_toggle_skip(self):
        self.skip_seen_messages = self.skip_var.get()
        self.log(f"🔁 Skip seen messages set to {self.skip_seen_messages}")

    def ensure_data_file(self, chat_id):
        """Ensure the data file exists and has a header."""
        if not self.bot_token:
            return None
        safe_token = self.bot_token.split(":")[0] if self.bot_token else "unknown"
        filename = os.path.join("captured_messages", f"bot_{safe_token}_chat_{chat_id}_data.txt")
        if not os.path.exists(filename):
            try:
                os.makedirs("captured_messages", exist_ok=True)
                with open(filename, "w", encoding="utf-8") as f:
                    f.write("=== Bot Information ===\n")
                    f.write(f"Bot Token: {self.bot_token}\n")
                    f.write(f"Bot Username: @{self.bot_username}\n")
                    f.write(f"Chat ID: {chat_id}\n")
                    f.write(f"Last Message ID: {self.last_message_id}\n")
                    f.write("\n=== Captured Messages ===\n\n")
            except Exception as e:
                self.log(f"❌ Error creating data file: {e}")
                return None
        return filename

    def get_seen_message_ids(self, chat_id):
        """Extract unique message IDs (both successful and missing) from data file."""
        if not self.bot_token:
            return set()
        safe_token = self.bot_token.split(":")[0]
        filename = os.path.join("captured_messages", f"bot_{safe_token}_chat_{chat_id}_data.txt")
        if not os.path.exists(filename):
            return set()
        seen = set()
        try:
            with open(filename, "r", encoding="utf-8", errors="ignore") as f:
                for line in f:
                    if "Message ID:" in line:
                        # Collect numeric tokens in the line
                        parts = line.replace("-", " ").replace("(", " ").split()
                        for p in parts:
                            if p.isdigit():
                                try:
                                    seen.add(int(p))
                                except ValueError:
                                    pass
        except Exception as e:
            self.log(f"❌ Error reading seen IDs: {e}")
        return seen

    def compute_unseen_ranges(self, start_id, max_id, seen_ids):
        if start_id > max_id:
            return []
        if not seen_ids:
            return [(start_id, max_id)]
        filtered = sorted(i for i in seen_ids if start_id <= i <= max_id)
        ranges = []
        cursor = start_id
        for sid in filtered:
            if sid < cursor:
                continue
            if sid > cursor:
                ranges.append((cursor, sid - 1))
            cursor = sid + 1
        if cursor <= max_id:
            ranges.append((cursor, max_id))
        return ranges

    def record_missing_message_id(self, chat_id, message_id):
        if message_id in self.missing_ids:
            return
        filename = self.ensure_data_file(chat_id)
        if not filename:
            return
        try:
            with open(filename, "a", encoding="utf-8") as f:
                f.write(f"\n--- Missing Message ID: {message_id} (HTTP 400 Not Found) ---\n")
            self.missing_ids.add(message_id)
        except Exception as e:
            self.log(f"❌ Failed to record missing ID {message_id}: {e}")

    def save_message_to_file(self, chat_id, message_content):
        if message_content:
            os.makedirs("captured_messages", exist_ok=True)
            
            safe_token = self.bot_token.split(":")[0] if self.bot_token else "unknown"
            filename = os.path.join("captured_messages", f"bot_{safe_token}_chat_{chat_id}_data.txt")
            
            if not os.path.exists(filename):
                try:
                    with open(filename, "w", encoding="utf-8") as f:
                        f.write("=== Bot Information ===\n")
                        f.write(f"Bot Token: {self.bot_token}\n")
                        f.write(f"Bot Username: @{self.bot_username}\n")
                        f.write(f"Chat ID: {chat_id}\n")
                        f.write(f"Last Message ID: {self.last_message_id}\n")
                        f.write("\n=== Captured Messages ===\n\n")
                except Exception as e:
                    self.log(f"❌ Error creating file header: {e}")
                    return False
            
            try:
                with open(filename, "a", encoding="utf-8") as f:
                    f.write(f"\n--- Message ID: {message_content['message_id']} ---\n")
                    f.write(f"Date: {message_content['date']}\n")
                    if message_content['text']:
                        f.write(f"Text: {message_content['text']}\n")
                    if message_content['caption']:
                        f.write(f"Caption: {message_content['caption']}\n")
                    if message_content['file_id']:
                        f.write(f"File ID: {message_content['file_id']}\n")
                    f.write("----------------------------------------\n")
                return True
            except Exception as e:
                self.log(f"❌ Save to file error: {e}")
                return False
        return False

    def stop_forwarding(self):
        self.stop_flag = True
        self.log("➡️ [Stop Button] Stop request sent.")
        self.resume_button.config(state="normal")
        
        try:
            from_chat_id = self.chatid_entry.get().strip()
            if from_chat_id and not "Example:" in from_chat_id:
                safe_token = self.bot_token.split(":")[0] if self.bot_token else "unknown"
                filename = os.path.join("captured_messages", f"bot_{safe_token}_chat_{from_chat_id}_data.txt")
                
                if os.path.exists(filename):
                    self.log(f"📝 Messages saved in: {filename}")
                    messagebox.showinfo("Data Saved", f"All messages have been saved to: {os.path.basename(filename)}")
        except Exception as e:
            self.log(f"❌ Error accessing data file: {e}")

    def resume_forward(self):
        self.log(f"▶️ [Resume] Resuming from ID {self.stopped_id + 1}")
        self.stop_flag = False
        self.resume_button.config(state="disabled")
        from_chat_id = self.chatid_entry.get().strip()
        if not from_chat_id or "Example:" in from_chat_id:
            messagebox.showerror("Error", "Malicious Chat ID is empty!")
            return
        self.forward_continuation(from_chat_id, start_id=self.stopped_id + 1)

    def parse_bot_token(self, raw_token):
        raw_token = raw_token.strip()
        if raw_token.lower().startswith("bot"):
            raw_token = raw_token[3:]
        return raw_token

    def get_me(self, bot_token):
        webhook_info = requests.get(f"{TELEGRAM_API_URL}{bot_token}/getWebhookInfo").json()
        if webhook_info.get("ok") and webhook_info["result"].get("url"):
            requests.get(f"{TELEGRAM_API_URL}{bot_token}/deleteWebhook")
        url = f"{TELEGRAM_API_URL}{bot_token}/getMe"
        try:
            r = requests.get(url)
            data = r.json()
            if data.get("ok"):
                return data["result"]
            else:
                self.log(f"[getMe] Error: {data}")
                return None
        except Exception as e:
            self.log(f"[getMe] Req error: {e}")
            return None

    async def telethon_send_start(self, bot_username):
        try:
            await client.start(phone_number)
            self.log("✅ [Telethon] Logged in with your account.")
            if not bot_username.startswith("@"):
                bot_username = "@" + bot_username
            await client.send_message(bot_username, "/start")
            self.log(f"✅ [Telethon] '/start' sent to {bot_username}.")
            await asyncio.sleep(2)
        except Exception as e:
            self.log(f"❌ [Telethon] Send error: {e}")

    def get_updates(self, bot_token):
        url = f"{TELEGRAM_API_URL}{bot_token}/getUpdates"
        try:
            r = requests.get(url)
            data = r.json()
            if data.get("ok") and data["result"]:
                last_update = data["result"][-1]
                msg = last_update["message"]
                my_chat_id = msg["chat"]["id"]
                last_message_id = msg["message_id"]
                self.log(f"[getUpdates] my_chat_id={my_chat_id}, last_msg_id={last_message_id}")
                return my_chat_id, last_message_id
            else:
                self.log(f"[getUpdates] no result: {data}")
                return None, None
        except Exception as e:
            self.log(f"[getUpdates] error: {e}")
            return None, None

    def get_message_content(self, bot_token, chat_id, message_id):
        url = f"{TELEGRAM_API_URL}{bot_token}/getChat"
        payload = {
            "chat_id": chat_id
        }
        try:
            r = requests.post(url, json=payload)
            chat_data = r.json()
            
            url = f"{TELEGRAM_API_URL}{bot_token}/forwardMessage"
            payload = {
                "chat_id": self.my_chat_id,
                "from_chat_id": chat_id,
                "message_id": message_id
            }
            r = requests.post(url, json=payload)
            data = r.json()
            
            if data.get("ok"):
                message = data["result"]
                content = {
                    "message_id": message_id,
                    "chat_id": chat_id,
                    "date": message.get("date"),
                    "text": message.get("text", ""),
                    "caption": message.get("caption", ""),
                    "file_id": None
                }
                
                media_types = ["photo", "document", "video", "audio", "voice", "sticker"]
                for media_type in media_types:
                    if media_type in message:
                        if isinstance(message[media_type], list):
                            content["file_id"] = message[media_type][-1].get("file_id")
                        else:
                            content["file_id"] = message[media_type].get("file_id")
                        break
                
                return content
            return None
        except Exception as e:
            self.log(f"❌ Get message content error ID {message_id}: {e}")
            return None
        
    def async_save_message_content(self, bot_token, chat_id, message_id):
        message_content = self.get_message_content(bot_token, chat_id, message_id)
        if message_content:
            success = self.save_message_to_file(chat_id, message_content)
            if success:
                self.log(f"📝 [Async] Saved message ID {message_id} to file.")
            else:
                self.log(f"⚠️ [Async] Failed to save message ID {message_id}.")
        else:
            self.log(f"⚠️ [Async] Failed to retrieve content for message ID {message_id}.")


    def forward_msg(self, bot_token, from_chat_id, to_chat_id, message_id):
        url = f"{TELEGRAM_API_URL}{bot_token}/forwardMessage"
        payload = {
            "from_chat_id": from_chat_id,
            "chat_id": to_chat_id,
            "message_id": message_id
        }
        try:
            r = self.session.post(url, json=payload)
            try:
                data = r.json()
            except Exception:
                data = {"raw": r.text}
            if r.status_code == 200 and data.get("ok"):
                self.log(f"✅ Forwarded message ID {message_id}.")
                threading.Thread(
                    target=self.async_save_message_content,
                    args=(bot_token, from_chat_id, message_id),
                    daemon=True
                ).start()
                return True
            else:
                if r.status_code == 400:
                    self.failed_400_ids.append(message_id)
                    self.record_missing_message_id(from_chat_id, message_id)
                    self.log(f"🚫 HTTP 400 (missing) message ID {message_id}. Data: {data}")
                else:
                    self.log(f"⚠️ Forward fail (status {r.status_code}) ID {message_id}, reason: {data}")
                return False
        except Exception as e:
            self.log(f"❌ Forward error ID {message_id}: {e}")
            return False


    def infiltration_process(self, attacker_id):
        found_any = False
        if self.last_message_id is None:
            self.last_message_id = 0
        start_id = self.last_message_id
        stop_id = max(1, self.last_message_id - self.max_older_attempts)
        self.log(f"Trying older IDs from {start_id} down to {stop_id}")
        for test_id in range(start_id, stop_id - 1, -1):
            if self.stop_flag:
                self.log("⏹️ Infiltration older ID check stopped by user.")
                return
            success = self.forward_msg(self.bot_token, attacker_id, self.my_chat_id, test_id)
            if success:
                self.log(f"✅ First older message captured! ID={test_id}")
                found_any = True
                break
            else:
                self.log(f"Try next older ID {test_id-1}...")
        if found_any:
            self.log("Now you can forward all messages if needed.")
        else:
            self.log("No older ID worked within our limit. Possibly no older messages or limit insufficient.")

    def start_infiltration(self):
        raw_token = self.token_entry.get().strip()
        if not raw_token or "Example:" in raw_token:
            messagebox.showerror("Error", "Bot Token cannot be empty!")
            return
        parsed_token = self.parse_bot_token(raw_token)
        info = self.get_me(parsed_token)
        if not info:
            messagebox.showerror("Error", "getMe failed or not a valid bot token!")
            return
        bot_user = info.get("username", None)
        if not bot_user:
            messagebox.showerror("Error", "No username found in getMe result!")
            return
        self.log(f"[getMe] Bot validated: @{bot_user}")
        messagebox.showinfo("getMe", f"Bot validated: @{bot_user}")
        self.bot_token = parsed_token
        self.bot_username = bot_user
        loop = asyncio.get_event_loop()
        loop.run_until_complete(self.telethon_send_start(bot_user))
        my_id, last_id = self.get_updates(parsed_token)
        if not my_id or not last_id:
            messagebox.showerror("Error", "getUpdates gave no valid results.")
            return
        self.my_chat_id = my_id
        self.last_message_id = last_id
        info_msg = (
            f"Bot username: @{bot_user}\n"
            f"my_chat_id: {my_id}\n"
            f"last_message_id: {last_id}\n\n"
            "We will now try older IDs in a background thread..."
        )
        self.log("[Infiltration] " + info_msg.replace("\n", " | "))
        messagebox.showinfo("Infiltration Complete", info_msg)
        attacker_id = self.chatid_entry.get().strip()
        if not attacker_id or "Example:" in attacker_id:
            self.log("⚠️ No attacker chat ID provided. Skipping older ID check.")
            return
        self.stop_flag = False
        t = threading.Thread(target=self.infiltration_process, args=(attacker_id,))
        t.start()

    def forward_all_messages(self):
        if not self.bot_token or not self.bot_username or not self.my_chat_id or not self.last_message_id:
            messagebox.showerror("Error", "You must do Infiltration Steps first!")
            return
        from_chat_id = self.chatid_entry.get().strip()
        if not from_chat_id or "Example:" in from_chat_id:
            messagebox.showerror("Error", "Malicious Chat ID is empty!")
            return
        self.stop_flag = False
        self.stopped_id = 0
        self.current_msg_id = 0
        self.resume_button.config(state="disabled")
        self.forward_continuation(from_chat_id, start_id=1)

    def forward_continuation(self, attacker_chat_id, start_id):
        def do_forward():
            if self.last_message_id is None:
                self.last_message_id = 0
            max_id = self.last_message_id
            success_count = 0
            seen_ids = set()
            unseen_ranges = []
            if self.skip_seen_messages:
                seen_ids = self.get_seen_message_ids(attacker_chat_id)
                unseen_ranges = self.compute_unseen_ranges(start_id, max_id, seen_ids)
                skipped_cnt = len([i for i in range(start_id, max_id + 1) if i in seen_ids])
                if seen_ids:
                    # Show up to 8 unseen ranges
                    display_ranges = ", ".join(
                        f"{a}-{b}" if a != b else str(a) for a, b in unseen_ranges[:8]
                    )
                    if len(unseen_ranges) > 8:
                        display_ranges += ", ..."
                    self.root.after(0, lambda: self.log(
                        f"🔁 Skipping {skipped_cnt} seen IDs. Unseen ranges: {display_ranges}"))
            if not unseen_ranges:
                unseen_ranges = [(start_id, max_id)] if start_id <= max_id else []

            for a, b in unseen_ranges:
                for msg_id in range(a, b + 1):
                    if self.stop_flag:
                        self.stopped_id = msg_id
                        self.root.after(0, lambda m=msg_id: self.log(f"⏹️ Stopped at ID {m} by user."))
                        break
                    if msg_id in seen_ids:  # safety
                        continue
                    ok = self.forward_msg(self.bot_token, attacker_chat_id, self.my_chat_id, msg_id)
                    if ok:
                        success_count += 1
                if self.stop_flag:
                    break
            if not self.stop_flag:
                txt = f"Forwarded from ID {start_id}..{max_id}, total success: {success_count}"
                if self.failed_400_ids:
                    preview = ", ".join(str(i) for i in self.failed_400_ids[:25])
                    if len(self.failed_400_ids) > 25:
                        preview += ", ..."
                    txt += f"\nMissing (HTTP 400) IDs: {len(self.failed_400_ids)} [{preview}]"
                self.root.after(0, lambda: [
                    self.log("[Result] " + txt.replace("\n", " | ")),
                    messagebox.showinfo("Result", txt)
                ])
            else:
                partial_txt = (
                    f"Stopped at ID {self.stopped_id}, total success: {success_count}.\n"
                    "Resume if needed."
                )
                if self.failed_400_ids:
                    partial_txt += f"\nMissing (HTTP 400) IDs so far: {len(self.failed_400_ids)}"
                self.root.after(0, lambda: [
                    self.log("[Result] " + partial_txt.replace("\n", " | "))
                ])
        t = threading.Thread(target=do_forward)
        t.start()

if __name__ == "__main__":
    root = tk.Tk()
    app = TelegramGUI(root)
    root.mainloop()
