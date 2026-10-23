"""Bounded, dependency-free webpage metadata extraction for note link cards."""

from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit, urlunsplit
import urllib.request


class PreviewParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.meta = {}
        self.title = []
        self.in_title = False
        self.images = []
        self.base_href = ""
        self.icon_href = ""

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "title":
            self.in_title = True
        if tag == "base" and not self.base_href:
            self.base_href = attrs.get("href", "")
        if tag == "link" and not self.icon_href:
            rel = (attrs.get("rel") or "").lower().split()
            if "icon" in rel or "apple-touch-icon" in rel:
                self.icon_href = attrs.get("href", "")
        if tag == "img":
            # Lazy-loaded pages often put a placeholder in src.
            candidates = [attrs.get(key, "") for key in ("data-src", "data-original", "data-lazy-src", "src")]
            srcset = attrs.get("data-srcset") or attrs.get("srcset") or ""
            if srcset:
                candidates.append(srcset.split(",")[0].strip().split(" ")[0])
            self.images.append(candidates)
        if tag == "meta":
            key = (attrs.get("property") or attrs.get("name") or "").lower()
            self.meta.setdefault(key, attrs.get("content", ""))

    def handle_endtag(self, tag):
        if tag == "title":
            self.in_title = False

    def handle_data(self, data):
        if self.in_title:
            self.title.append(data)

    def result(self, url):
        def clean(value, limit):
            return " ".join(value.split())[:limit]
        image = ""
        base = urljoin(url, self.base_href) if self.base_href else url
        icon = urljoin(base, self.icon_href) if self.icon_href else urljoin(url, "/favicon.ico")
        for candidates in self.images:
            for candidate in candidates:
                if not candidate.strip():
                    continue
                resolved = urljoin(base, candidate.strip())
                if urlsplit(resolved).scheme in {"http", "https"}:
                    image = resolved
                    break
            if image:
                break
        return {
            "title": clean("".join(self.title), 200) or clean(self.meta.get("og:title") or self.meta.get("twitter:title") or "", 200),
            "description": clean(self.meta.get("og:description") or self.meta.get("description") or self.meta.get("twitter:description") or self.meta.get("citation_title") or "", 400),
            "image": image if image != url and urlsplit(image).scheme in {"http", "https"} else "",
            "icon": icon if urlsplit(icon).scheme in {"http", "https"} else "",
            "siteName": clean(self.meta.get("og:site_name") or urlsplit(url).hostname or "", 80),
        }


def fetch_link_preview(url):
    parsed = urlsplit(str(url))
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("无效的网页链接")
    if parsed.path.lower().endswith(".pdf") and parsed.hostname not in {"arxiv.org", "www.arxiv.org"}:
        return {"title": parsed.path.rsplit("/", 1)[-1], "description": "PDF 文档 · 可一键导入文献库", "image": "", "siteName": parsed.hostname}
    if parsed.hostname in {"arxiv.org", "www.arxiv.org"}:
        path = parsed.path.replace("/pdf/", "/abs/", 1).replace("/html/", "/abs/", 1)
        if path.endswith(".pdf"):
            path = path[:-4]
        url = urlunsplit((parsed.scheme, parsed.netloc, path, "", ""))
    request = urllib.request.Request(url, headers={"User-Agent": "PaperLantern/1.0 (Link Preview)", "Accept": "text/html"})
    with urllib.request.urlopen(request, timeout=8) as response:
        if response.headers.get_content_type() not in {"text/html", "application/xhtml+xml"}:
            return {}
        body = response.read(512 * 1024).decode(response.headers.get_content_charset() or "utf-8", errors="replace")
        parser = PreviewParser()
        parser.feed(body)
        return parser.result(response.geturl())
