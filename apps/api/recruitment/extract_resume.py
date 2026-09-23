"""受限子进程，只提取文字，不执行文档脚本或外部链接。"""

import json
import resource
import sys
import zipfile
from xml.etree import ElementTree

resource.setrlimit(resource.RLIMIT_CPU, (10, 10))
if sys.platform == "linux":
    resource.setrlimit(resource.RLIMIT_AS, (768 * 1024 * 1024, 768 * 1024 * 1024))


def extract(path, kind):
    chunks = []
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
            root = ElementTree.fromstring(raw)
            ns = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
            for i, paragraph in enumerate(root.iter(ns + "p")):
                text = "".join(t.text or "" for t in paragraph.iter(ns + "t"))
                if text.strip():
                    chunks.append(f"[段落 {i + 1}] {text}")
    result = "\n\n".join(chunks).replace("\x00", "").strip()
    if not result:
        raise ValueError("未读取到文字，可能是扫描件或空文档。OCR 未接通，可人工摘录。")
    if len(result) > 100000:
        raise ValueError("文字超过十万字，请提供精简版。")
    return result


if __name__ == "__main__":
    try:
        print(json.dumps({"text": extract(sys.argv[1], sys.argv[2])}, ensure_ascii=False))
    except ValueError as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False))
    except Exception:
        print(
            json.dumps(
                {"error": "文件损坏或格式不受支持。请重传有效文件，或人工摘录。"},
                ensure_ascii=False,
            )
        )
