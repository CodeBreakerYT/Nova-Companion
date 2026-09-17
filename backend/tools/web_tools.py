import urllib.parse
import webbrowser

from pydantic import BaseModel, Field


class OpenUrlArgs(BaseModel):
    url: str = Field(..., description="A full http(s) URL to open in the user's default browser")


def open_url(args: OpenUrlArgs) -> dict:
    url = args.url.strip()
    if not (url.startswith("http://") or url.startswith("https://")):
        url = "https://" + url
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return {"status": "error", "message": "That doesn't look like a valid URL."}
    webbrowser.open(url)
    return {"status": "ok", "message": f"Opened {url} in your browser."}


class WebSearchArgs(BaseModel):
    query: str = Field(..., description="What to search for on the web")


def web_search(args: WebSearchArgs) -> dict:
    url = "https://www.google.com/search?q=" + urllib.parse.quote(args.query)
    webbrowser.open(url)
    return {"status": "ok", "message": f"Opened a web search for '{args.query}'."}
