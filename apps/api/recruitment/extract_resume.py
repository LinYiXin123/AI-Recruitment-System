"""受限子进程，只提取文字，不执行文档脚本或外部链接。"""

import html
import json
import re
import sys
import zipfile
from urllib.parse import urlsplit
from xml.etree import ElementTree

try:
    import resource
except ImportError:
    resource = None

if resource:
    resource.setrlimit(resource.RLIMIT_CPU, (10, 10))
if resource and sys.platform == "linux":
    resource.setrlimit(resource.RLIMIT_AS, (768 * 1024 * 1024, 768 * 1024 * 1024))


def _safe_url(value):
    value = str(value or "").strip()
    parts = urlsplit(value)
    if parts.scheme in {"http", "https"} and parts.netloc:
        return value
    if parts.scheme == "mailto" and parts.path:
        return value
    return ""


def _linkify(value):
    pattern = re.compile(r"https?://[^\s<>\"']+|www\.[^\s<>\"']+")
    result = []
    offset = 0
    for match in pattern.finditer(value):
        url = match.group()
        trimmed = url.rstrip(".,;:!?，。；：！？)]}）】")
        if not trimmed:
            continue
        safe = _safe_url(trimmed if "://" in trimmed else f"https://{trimmed}")
        if not safe:
            continue
        result.append(html.escape(value[offset : match.start()]))
        result.append(
            f'<a href="{html.escape(safe, quote=True)}" target="_blank" '
            f'rel="noopener noreferrer">{html.escape(trimmed)}</a>'
        )
        offset = match.start() + len(trimmed)
    result.append(html.escape(value[offset:]).replace("\r\n", "\n").replace("\n", "<br>"))
    return "".join(result).replace("\r\n", "\n").replace("\n", "<br>")


def _docx_content(archive, ns):
    root = ElementTree.fromstring(archive.read("word/document.xml"))
    relation_ns = "{http://schemas.openxmlformats.org/package/2006/relationships}"
    rel_id = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
    links = {}
    if "word/_rels/document.xml.rels" in archive.namelist():
        relations = ElementTree.fromstring(archive.read("word/_rels/document.xml.rels"))
        links = {
            relation.get("Id"): _safe_url(relation.get("Target"))
            for relation in relations.findall(relation_ns + "Relationship")
            if relation.get("Type", "").endswith("/hyperlink")
            and relation.get("TargetMode") == "External"
        }

    def render(node, in_link=False):
        if node.tag == ns + "r":
            text = "".join(child.text or "" for child in node.iter(ns + "t"))
            rendered = html.escape(text).replace("\r\n", "\n").replace("\n", "<br>")
            if not in_link:
                rendered = _linkify(text)
            properties = node.find(ns + "rPr")
            bold = properties.find(ns + "b") if properties is not None else None
            if bold is not None and bold.get(ns + "val", "1").lower() not in {"0", "false", "off"}:
                rendered = f"<strong>{rendered}</strong>"
            return rendered
        children = "".join(render(child, in_link or node.tag == ns + "hyperlink") for child in node)
        if node.tag == ns + "hyperlink":
            url = links.get(node.get(rel_id), "")
            if url:
                return (
                    f'<a href="{html.escape(url, quote=True)}" target="_blank" '
                    f'rel="noopener noreferrer">{children}</a>'
                )
        if node.tag == ns + "p":
            return f"<p>{children}</p>"
        return children

    plain, rich = [], []
    for index, paragraph in enumerate(root.iter(ns + "p"), 1):
        text = "".join(item.text or "" for item in paragraph.iter(ns + "t"))
        if text.strip():
            plain.append(f"[段落 {index}] {text}")
            children = "".join(render(child) for child in paragraph)
            rich.append(f"<p>[段落 {index}] {children}</p>")
    return "\n\n".join(plain), "".join(rich)


def extract(path, kind):
    chunks, rich_chunks = [], []
    if kind == "pdf":
        from pypdf import PdfReader

        reader = PdfReader(path)
        if reader.is_encrypted:
            raise ValueError("加密文件无法提取，请提供解密版本或人工摘录。")
        if len(reader.pages) > 100:
            raise ValueError("文件超过 100 页，请拆分后重传。")
        for i, page in enumerate(reader.pages):
            content = page.get_contents()
            if content and len(content.get_data()) > 10 * 1024 * 1024:
                raise ValueError("页面过于复杂，请提供精简版或人工摘录。")
            text = page.extract_text() or ""
            if text.strip():
                chunks.append(f"[第 {i + 1} 页]\n{text}")
                runs = []
                page.extract_text(
                    visitor_text=lambda value, _cm, _tm, font, _size: runs.append(
                        (value, "bold" in str(font.get("/BaseFont", "")).lower() if font else False)
                    )
                )
                visitor_text = "".join(value for value, _bold in runs)
                if not visitor_text.strip() or len(visitor_text.strip()) < len(text.strip()) * 0.8:
                    rich = _linkify(text)
                else:
                    rich = "".join(
                        f"<strong>{_linkify(value)}</strong>" if bold else _linkify(value)
                        for value, bold in runs
                    )
                links = []
                for annotation in page.get("/Annots") or []:
                    action = annotation.get_object().get("/A")
                    if action:
                        if hasattr(action, "get_object"):
                            action = action.get_object()
                        url = _safe_url(action.get("/URI"))
                        if url and url not in links:
                            links.append(url)
                missing_links = [
                    url for url in links if html.escape(url, quote=True) not in rich
                ]
                for url in missing_links:
                    chunks.append(f"[简历链接] {url}")
                    rich += (
                        f'<br><a href="{html.escape(url, quote=True)}" target="_blank" '
                        f'rel="noopener noreferrer">{html.escape(url)}</a>'
                    )
                rich_chunks.append(f"<p>[第 {i + 1} 页]</p><div>{rich}</div>")
    else:
        with zipfile.ZipFile(path) as archive:
            entries = archive.infolist()
            if len(entries) > 2000 or sum(e.file_size for e in entries) > 30 * 1024 * 1024:
                raise ValueError("文档解压体积过大，请提供精简版。")
            if any("vbaproject" in e.filename.lower() for e in entries):
                raise ValueError("不接收包含宏的文档，请另存为普通 DOCX。")
            raw = archive.read("word/document.xml")
            if b"<!DOCTYPE" in raw or b"<!ENTITY" in raw:
                raise ValueError("文档包含不支持的内容，请另存后重传。")
            if "word/_rels/document.xml.rels" in archive.namelist():
                relationships = archive.read("word/_rels/document.xml.rels")
                if b"<!DOCTYPE" in relationships or b"<!ENTITY" in relationships:
                    raise ValueError("文档包含不支持的内容，请另存后重传。")
            ns = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
            text, rich = _docx_content(archive, ns)
            chunks.extend(text.split("\n\n"))
            rich_chunks.append(rich)
    result = "\n\n".join(chunks).replace("\x00", "").strip()
    if not result:
        raise ValueError("未读取到文字，可能是扫描件或空文档。OCR 未接通，可人工摘录。")
    if len(result) > 100000:
        raise ValueError("文字超过十万字，请提供精简版。")
    return {"text": result, "html": "".join(rich_chunks)}


def write_result(result):
    sys.stdout.buffer.write(json.dumps(result, ensure_ascii=False).encode("utf-8"))


if __name__ == "__main__":
    try:
        write_result(extract(sys.argv[1], sys.argv[2]))
    except ValueError as e:
        write_result({"error": str(e)})
    except Exception:
        write_result({"error": "文件损坏或格式不受支持。请重传有效文件，或人工摘录。"})
