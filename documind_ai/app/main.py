"""
DocuMind AI backend.

Implements the endpoints defined in the Technical Requirements Document:
  POST /api/analyze  -> summarize | key_points | rewrite (streamed)
  POST /api/ask      -> question answering grounded in the document (streamed)
  GET  /api/health   -> health check for load balancer / AWS App Runner / Render

Security notes (per TRD section 6):
  - GEMINI_API_KEY is read from the environment only, never hardcoded.
  - The key never appears in any response body, log line, or frontend asset.
  - Uploaded files are validated for type and size before any Gemini call.
"""

import io
import os
from pathlib import Path
from typing import Optional

import google.generativeai as genai
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pypdf import PdfReader

# ✅ Load dotenv with explicit path
from dotenv import load_dotenv
load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env")

from documind_ai.app.prompts import build_prompt

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB
MAX_DOCUMENT_CHARS = 30_000       # safe context window

# ✅ Read Gemini API key
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    raise RuntimeError(
        "GEMINI_API_KEY environment variable is not set. "
        "Copy .env.example to .env and add your key, or set it in your "
        "deployment platform's environment variable settings."
    )

genai.configure(api_key=GEMINI_API_KEY)

# ✅ Default model
MODEL_NAME = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash")

app = FastAPI(title="DocuMind AI")

allowed_origin = os.environ.get("ALLOWED_ORIGIN", "*")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[allowed_origin],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def extract_pdf_text(data: bytes) -> str:
    try:
        reader = PdfReader(io.BytesIO(data))
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail="Could not read this PDF. It may be corrupted or password-protected.",
        ) from exc

    if reader.is_encrypted:
        raise HTTPException(
            status_code=400,
            detail="This PDF is password-protected. Please upload an unlocked file.",
        )

    pages = []
    for page in reader.pages:
        try:
            pages.append(page.extract_text() or "")
        except Exception:
            continue

    text = "\n".join(pages).strip()
    if not text:
        raise HTTPException(
            status_code=400,
            detail="No extractable text was found in this PDF (it may be a scanned image).",
        )
    return text


def clean_document_text(text: str, max_chars: int = MAX_DOCUMENT_CHARS) -> str:
    text = text.strip()
    if len(text) > max_chars:
        text = text[:max_chars]
    return text


async def get_document_text(file: Optional[UploadFile], text: Optional[str]) -> str:
    if file is not None:
        data = await file.read()
        if len(data) > MAX_FILE_SIZE:
            raise HTTPException(status_code=400, detail="File too large -- 10 MB max.")
        is_pdf = (file.content_type == "application/pdf") or (
            file.filename or ""
        ).lower().endswith(".pdf")
        if not is_pdf:
            raise HTTPException(status_code=400, detail="Only PDF files are supported for upload.")
        extracted = extract_pdf_text(data)
        return clean_document_text(extracted)

    if text and text.strip():
        return clean_document_text(text)

    raise HTTPException(status_code=400, detail="Please upload a PDF or paste some text to analyze.")


async def stream_gemini(prompt: str):
    """Yield text chunks from Gemini as they are generated."""
    model = genai.GenerativeModel(MODEL_NAME)
    try:
        response = await model.generate_content_async(prompt, stream=True)
        async for chunk in response:
            if chunk.text:
                yield chunk.text
    except Exception as exc:
        yield f"\n\n[The AI service couldn't complete this request. Please try again. ({type(exc).__name__})]"

# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.post("/api/analyze")
async def analyze(
    action: str = Form(...),
    text: Optional[str] = Form(None),
    tone: Optional[str] = Form(None),
    length: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
):
    if action not in {"summarize", "key_points", "rewrite"}:
        raise HTTPException(status_code=400, detail="Unknown action.")

    document_text = await get_document_text(file, text)
    prompt = build_prompt(action, document_text, tone=tone, length=length)
    return StreamingResponse(stream_gemini(prompt), media_type="text/plain")


@app.post("/api/ask")
async def ask(
    question: str = Form(...),
    text: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
):
    if not question or not question.strip():
        raise HTTPException(status_code=400, detail="Please enter a question.")

    document_text = await get_document_text(file, text)
    prompt = build_prompt("ask", document_text, question=question)
    return StreamingResponse(stream_gemini(prompt), media_type="text/plain")

# ---------------------------------------------------------------------------
# Static frontend
# ---------------------------------------------------------------------------

frontend_path = Path(__file__).resolve().parent.parent / "static"
app.mount("/", StaticFiles(directory=str(frontend_path), html=True), name="static")
