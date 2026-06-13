"""Generate NHID_MASTER_KNOWLEDGE_ARCHIVE.pdf from the markdown source."""
import re
import sys
import unicodedata
import markdown
from weasyprint import HTML, CSS

SRC = "NHID_MASTER_KNOWLEDGE_ARCHIVE.md"
OUT = "NHID-Clinical-Master-Knowledge-Archive.pdf"

# ── Step 1: read source ───────────────────────────────────────────────────────
with open(SRC, encoding="utf-8") as f:
    text = f.read()

# ── Step 2: strip / replace non-ASCII-safe characters ────────────────────────
# Middle dot and similar separators → plain ASCII pipe
text = text.replace("·", "|")        # · middle dot
text = text.replace("•", "-")        # • bullet
text = text.replace("’", "'")        # ' right single quote
text = text.replace("‘", "'")        # ' left single quote
text = text.replace("“", '"')        # " left double quote
text = text.replace("”", '"')        # " right double quote
text = text.replace("–", "-")        # – en dash
text = text.replace("—", "--")       # — em dash
text = text.replace("…", "...")      # … ellipsis
text = text.replace("©", "(c)")      # © copyright
text = text.replace("®", "(R)")      # ® registered
text = text.replace("™", "(TM)")     # ™ trademark
text = text.replace("×", "x")        # × multiplication sign
text = text.replace("−", "-")        # − minus sign
text = text.replace("≥", ">=")       # ≥
text = text.replace("≤", "<=")       # ≤
text = text.replace("≠", "!=")       # ≠
text = text.replace("→", "->")       # →
text = text.replace("←", "<-")       # ←
text = text.replace("↔", "<->")      # ↔
text = text.replace("±", "+/-")      # ±
text = text.replace("°", " deg")     # °
text = text.replace("α", "alpha")    # α
text = text.replace("β", "beta")     # β
text = text.replace("γ", "gamma")    # γ

# Remove any remaining non-ASCII-safe chars that could render as diamonds
cleaned = []
for ch in text:
    if ord(ch) < 128:
        cleaned.append(ch)
    elif unicodedata.category(ch) in ("Ll", "Lu", "Lt", "Lo", "Nd", "Zs", "Po", "Pd", "Ps", "Pe"):
        cleaned.append(ch)
    else:
        # Replace unknown high-codepoint chars with safe ASCII
        name = unicodedata.name(ch, "")
        if "HYPHEN" in name or "DASH" in name:
            cleaned.append("-")
        elif "QUOTE" in name:
            cleaned.append("'")
        elif "BULLET" in name or "DOT" in name:
            cleaned.append(".")
        elif "ARROW" in name:
            cleaned.append("->")
        else:
            cleaned.append(" ")  # drop unknown chars
text = "".join(cleaned)

# ── Step 3: handle KaTeX math blocks → styled code blocks ────────────────────
# Block math: $$...$$
def block_math(m):
    inner = m.group(1).strip()
    # Convert LaTeX macros to readable plain text
    inner = re.sub(r"\\mathrm\{([^}]+)\}", r"\1", inner)
    inner = re.sub(r"\\text\{([^}]+)\}", r"\1", inner)
    inner = re.sub(r"\\texttt\{([^}]+)\}", r"\1", inner)
    inner = re.sub(r"\\bigl?[\|\\{]", "", inner)
    inner = re.sub(r"\\bigr?[\|\\}]", "", inner)
    inner = re.sub(r"\\left[\|\\{]?", "", inner)
    inner = re.sub(r"\\right[\|\\}]?", "", inner)
    inner = inner.replace(r"\,", " ")
    inner = inner.replace(r"\!", "")
    inner = inner.replace(r"\geq", ">=")
    inner = inner.replace(r"\leq", "<=")
    inner = inner.replace(r"\neq", "!=")
    inner = inner.replace(r"\times", "x")
    inner = inner.replace(r"\cdot", "*")
    inner = inner.replace(r"\{", "{").replace(r"\}", "}")
    inner = inner.replace(r"\_", "_")
    inner = inner.replace(r"\in", "in")
    inner = re.sub(r"\\[a-zA-Z]+", "", inner)
    inner = re.sub(r"\s+", " ", inner).strip()
    return f"\n```math\n{inner}\n```\n"

text = re.sub(r"\$\$\s*([\s\S]*?)\s*\$\$", block_math, text)

# Inline math: $...$
def inline_math(m):
    inner = m.group(1)
    inner = re.sub(r"\\mathrm\{([^}]+)\}", r"\1", inner)
    inner = re.sub(r"\\text\{([^}]+)\}", r"\1", inner)
    inner = re.sub(r"\\texttt\{([^}]+)\}", r"\1", inner)
    inner = inner.replace(r"\_", "_")
    inner = inner.replace(r"\,", " ")
    inner = re.sub(r"\\[a-zA-Z]+", "", inner)
    return f"`{inner.strip()}`"

text = re.sub(r"\$([^$\n]+?)\$", inline_math, text)

# ── Step 4: convert markdown → HTML ──────────────────────────────────────────
md = markdown.Markdown(extensions=[
    "tables", "fenced_code", "codehilite", "toc", "nl2br"
])
body_html = md.convert(text)

# ── Step 5: assemble full HTML with PDF-safe CSS ──────────────────────────────
html_doc = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>NHID-Clinical Master Knowledge Archive</title>
<style>
  /* Page setup */
  @page {{
    size: letter;
    margin: 1in 0.9in 1in 0.9in;
    @bottom-center {{
      content: "NHID-Clinical | CC BY 4.0 | nhid-clinical.org";
      font-family: "Helvetica Neue", Arial, sans-serif;
      font-size: 8pt;
      color: #666;
    }}
    @bottom-right {{
      content: counter(page);
      font-family: "Helvetica Neue", Arial, sans-serif;
      font-size: 8pt;
      color: #666;
    }}
  }}

  /* Base typography */
  body {{
    font-family: "Helvetica Neue", Arial, "Liberation Sans", sans-serif;
    font-size: 10.5pt;
    line-height: 1.55;
    color: #1a1a1a;
    max-width: 100%;
    word-wrap: break-word;
    overflow-wrap: break-word;
  }}

  /* Headings */
  h1 {{ font-size: 22pt; color: #003d52; border-bottom: 2px solid #00c2a8; padding-bottom: 6pt; margin-top: 0; page-break-before: avoid; }}
  h2 {{ font-size: 16pt; color: #003d52; border-bottom: 1px solid #00c2a8; padding-bottom: 4pt; margin-top: 24pt; page-break-after: avoid; }}
  h3 {{ font-size: 13pt; color: #00566b; margin-top: 18pt; page-break-after: avoid; }}
  h4 {{ font-size: 11.5pt; color: #007a8a; margin-top: 14pt; page-break-after: avoid; }}
  h5, h6 {{ font-size: 10.5pt; color: #007a8a; font-style: italic; }}

  /* Paragraphs */
  p {{ margin: 6pt 0 8pt 0; orphans: 3; widows: 3; }}

  /* Tables */
  table {{
    width: 100%;
    border-collapse: collapse;
    margin: 10pt 0 12pt 0;
    font-size: 9.5pt;
    page-break-inside: auto;
  }}
  th {{
    background: #003d52;
    color: #ffffff;
    padding: 5pt 8pt;
    text-align: left;
    font-weight: bold;
  }}
  td {{
    padding: 4pt 8pt;
    border-bottom: 1px solid #d0d0d0;
    vertical-align: top;
  }}
  tr:nth-child(even) td {{ background: #f4f8f9; }}

  /* Code */
  code {{
    font-family: "Courier New", Courier, monospace;
    font-size: 9pt;
    background: #f0f4f5;
    padding: 1pt 3pt;
    border-radius: 2pt;
    color: #003d52;
  }}
  pre {{
    background: #f0f4f5;
    border-left: 3pt solid #00c2a8;
    padding: 10pt 12pt;
    overflow-x: auto;
    font-size: 8.5pt;
    line-height: 1.45;
    page-break-inside: avoid;
    white-space: pre-wrap;
    word-break: break-all;
  }}
  pre code {{
    background: none;
    padding: 0;
    font-size: inherit;
  }}
  /* Math blocks (fenced as ```math) */
  .language-math, .codehilite .language-math, pre.language-math {{
    background: #eef6f7;
    border-left: 3pt solid #53d8fb;
    font-style: italic;
    text-align: center;
    padding: 10pt 20pt;
  }}

  /* Blockquotes */
  blockquote {{
    border-left: 4pt solid #00c2a8;
    margin: 10pt 0;
    padding: 6pt 14pt;
    background: #f4fafb;
    color: #333;
    font-style: italic;
  }}

  /* Lists */
  ul, ol {{ margin: 6pt 0 8pt 20pt; padding: 0; }}
  li {{ margin-bottom: 3pt; }}

  /* Horizontal rules */
  hr {{
    border: none;
    border-top: 1px solid #c8d8db;
    margin: 18pt 0;
  }}

  /* Links */
  a {{ color: #007a8a; text-decoration: none; }}

  /* Strong / em */
  strong {{ color: #003d52; }}

  /* Cover / title area */
  .cover {{
    text-align: center;
    padding: 40pt 0 30pt 0;
    border-bottom: 3pt solid #00c2a8;
    margin-bottom: 30pt;
  }}
  .cover h1 {{ border: none; }}
</style>
</head>
<body>
{body_html}
</body>
</html>"""

# ── Step 6: render PDF ────────────────────────────────────────────────────────
print(f"Rendering {OUT} ...")
HTML(string=html_doc, base_url=".").write_pdf(OUT)
print(f"Done. Output: {OUT}")
