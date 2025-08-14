import requests
import re

BOT_PATTERN = re.compile(r'(?:bot)?\d+:[A-Za-z0-9_-]{35,}')
CHAT_ID_PATTERN = re.compile(r'(?:["\'](-?\d{7,14})["\'])|(?:chat_id|from_chat_id)\W+(-?\d{7,14})')

def search_urlscan_and_hunt(api_key):
    if not api_key:
        return [("Error: URLSCAN_API_KEY missing!", [], [])]
    query = "domain:api.telegram.org"
    url = f"https://urlscan.io/api/v1/search/?q={query}&size=50"
    headers = {"API-Key": api_key}
    try:
        resp = requests.get(url, headers=headers, timeout=10)
        data = resp.json()
        if "results" not in data or not data["results"]:
            return [("No results from URLScan", [], [])]
        results_list = []
        for entry in data["results"]:
            scan_id = entry.get("_id")
            if not scan_id:
                continue
            page_info = entry.get("page", {})
            site_url = page_info.get("url", f"UUID:{scan_id}")
            detail_url = f"https://urlscan.io/api/v1/result/{scan_id}"
            try:
                detail_resp = requests.get(detail_url, headers=headers, timeout=10)
                if detail_resp.status_code == 200:
                    detail_json = detail_resp.json()
                    data_obj = detail_json.get("data", {})
                    html = data_obj.get("dom", "")
                    if not html:
                        dom_url = f"https://urlscan.io/dom/{scan_id}"
                        dom_resp = requests.get(dom_url, headers=headers, timeout=10)
                        if dom_resp.status_code == 200:
                            html = dom_resp.text
                    found_tokens = BOT_PATTERN.findall(html)
                    chat_matches = CHAT_ID_PATTERN.findall(html)
                    found_chats = []
                    for g1, g2 in chat_matches:
                        if g1:
                            found_chats.append(g1)
                        elif g2:
                            found_chats.append(g2)
                    results_list.append((site_url, found_tokens, found_chats))
                else:
                    results_list.append((f"Error fetch result {scan_id}", [], []))
            except Exception as ex2:
                results_list.append((f"Error detail {scan_id} => {ex2}", [], []))
        return results_list
    except Exception as e:
        return [(f"URLScan Request Error: {e}", [], [])]
