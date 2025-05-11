# Matkap

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE) [![Python](https://img.shields.io/badge/python-3.7%2B-blue.svg)](https://www.python.org/) [![Build Status](https://img.shields.io/badge/build-passing-green)](#)

> **Matkap** is a desktop application for ethical security research, enabling rapid infiltration and analysis of potentially malicious Telegram bots via a user-friendly GUI.

---

## Table of Contents
- [Key Features](#-key-features)
- [Screenshots](#-screenshots)
- [Installation](#️-installation)
- [Configuration](#-configuration)
- [Usage](#-usage)
- [Output & Logs](#-output--logs)
- [Contributing](#-contributing)
- [License](#-license)

---

## Key Features

- **Centralized Configuration**: All settings in `config.json` for themes, credentials, and API keys.
- **Modern GUI**: Dark/Light mode, adjustable font sizes, auto-scroll logs.
- **Threaded Operations**: All long-running tasks (infiltration, forwarding, scanning) run in background threads to ensure a responsive interface.
- **Telegram Bot Infiltration**: Validate bot tokens, send `/start` via Telethon, capture and forward historical messages.
- **FOFA & URLScan Scans**: Integrated API hunters to discover exposed tokens and chat IDs on FOFA and URLScan.
- **Export & Persistence**: Save logs to `logs.txt` and captured messages under `captured_messages/` with structured headers.

---

## Screenshots

<p align="center">
  <img src="https://i.imgur.com/PkrTk6K.png" alt="UI" width="400"/>
</p>
<p align="center">
  <img src="https://i.imgur.com/gSOHrRQ.png" alt="SettingsUI" width="400"/>
</p>

---

## Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/0x6rss/matkap.git
   cd matkap
   ```
2. **Create virtual environment (optional but recommended)**
   ```bash
   python -m venv venv
   source venv/bin/activate  # Linux/macOS
   venv\Scripts\activate   # Windows
   ```
3. **Install dependencies**
   ```bash
   pip install -r requirements.txt
   ```

---

## Configuration

After the first launch, `config.json` is auto-generated. Edit it to provide your credentials and preferences:

```json
{
  "theme": "Dark",
  "font_size": 12,
  "max_older_attempts": 300,
  "log_limit": 1000,
  "auto_scroll": true,
  "telegram_phone": "+1234567890",
  "telegram_api_id": "123456",
  "telegram_api_hash": "your_api_hash",
  "fofa_email": "your_fofa_email",
  "fofa_key": "your_fofa_key",
  "urlscan_key": "your_urlscan_key"
}
```

- **telegram_phone**, **telegram_api_id**, **telegram_api_hash**: Credentials from [my.telegram.org/apps](https://my.telegram.org/apps)
- **fofa_email**, **fofa_key**, **urlscan_key**: Optional API keys for extended scanning
- **theme**: `Dark` or `Light`
- **font_size**: Log area font size
- **max_older_attempts**: Number of backward message IDs to probe
- **log_limit**: Maximum lines retained in log view
- **auto_scroll**: Toggle automatic scrolling

---

## Usage

Launch the application:
```bash
python matkap.py
```

1. **Start Attack**: Input bot token (e.g. `bot123:ABC...`) and target chat ID, click **Start Attack**.
2. **Forward All**: Click **Forward All** to retrieve messages history; use **Stop**/**Resume** to control.
3. **Hunt FOFA**: Click **Hunt FOFA** to search exposed bot artifacts via FOFA API.
4. **Hunt URLScan**: Click **Hunt URLScan** to scan via URLScan API.
5. **Export Logs**: Click **Export Logs** to save `logs.txt`.

---

## Output & Logs
- **Logs**: Saved in `logs.txt` with timestamped entries.
- **Captured Messages**: Stored in `captured_messages/` with detailed headers.

---

## Contributing
Contributions, issues, and feature requests are welcome! Please see [CONTRIBUTING](CONTRIBUTING.md).

---

## License
This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.

---

## Legal
Please refer to the [LEGAL](LEGAL.md) file for the full legal disclaimer and terms of use.
