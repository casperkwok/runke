"""文件解析：把上传的二进制文档解析成纯文本，供分块入库。

支持：pdf / docx / pptx / xlsx / csv / txt / md / json / log。
.doc/.ppt(旧二进制) 不支持，请转存为 .docx/.pptx。
"""
import io
import os


class UnsupportedFileError(Exception):
    pass


def _parse_pdf(data: bytes) -> str:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    pages = [(p.extract_text() or "").strip() for p in reader.pages]
    return "\n\n".join(p for p in pages if p)


def _parse_docx(data: bytes) -> str:
    import docx2txt

    return (docx2txt.process(io.BytesIO(data)) or "").strip()


def _parse_pptx(data: bytes) -> str:
    """逐张幻灯片提取：标题/正文文本框 + 表格 + 备注，按幻灯片分段。"""
    from pptx import Presentation

    prs = Presentation(io.BytesIO(data))
    out: list[str] = []
    for i, slide in enumerate(prs.slides, 1):
        parts: list[str] = []
        for shape in slide.shapes:
            if shape.has_text_frame:
                t = "\n".join(p.text for p in shape.text_frame.paragraphs if p.text.strip())
                if t.strip():
                    parts.append(t.strip())
            if shape.has_table:
                tbl = shape.table
                for row in tbl.rows:
                    cells = [c.text.strip() for c in row.cells]
                    if any(cells):
                        parts.append(" | ".join(cells))
        # 备注
        if slide.has_notes_slide:
            note = slide.notes_slide.notes_text_frame.text.strip()
            if note:
                parts.append(f"[备注] {note}")
        if parts:
            out.append(f"# 幻灯片 {i}\n" + "\n".join(parts))
    return "\n\n".join(out)


def _parse_xlsx(data: bytes) -> str:
    from openpyxl import load_workbook

    wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    out: list[str] = []
    for ws in wb.worksheets:
        rows: list[str] = []
        for row in ws.iter_rows(values_only=True):
            cells = ["" if c is None else str(c) for c in row]
            if any(cells):
                rows.append(" | ".join(cells))
        if rows:
            out.append(f"# 工作表 {ws.title}\n" + "\n".join(rows))
    wb.close()
    return "\n\n".join(out)


def _parse_text(data: bytes) -> str:
    for enc in ("utf-8", "gbk", "latin-1"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="ignore")


_PARSERS = {
    ".pdf": _parse_pdf,
    ".docx": _parse_docx,
    ".pptx": _parse_pptx,
    ".xlsx": _parse_xlsx,
}
_TEXT_EXT = {".txt", ".md", ".markdown", ".csv", ".json", ".log", ".tsv", ".html", ".htm"}


def parse_file(filename: str, data: bytes) -> str:
    ext = os.path.splitext(filename or "")[1].lower()
    if ext in _PARSERS:
        return _PARSERS[ext](data).strip()
    if ext in _TEXT_EXT or not ext:
        return _parse_text(data).strip()
    if ext in (".doc", ".ppt"):
        raise UnsupportedFileError(f"暂不支持旧版二进制格式 {ext}，请转存为 .docx / .pptx 后上传")
    raise UnsupportedFileError(f"不支持的文件类型：{ext}")
