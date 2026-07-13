# DocuMind AI

An AI-powered document analyzer. Upload a PDF or paste text and get a streamed
summary, key points, a grounded answer to a question, or a rewrite in a
different tone — built with FastAPI, the Google Gemini API, and a vanilla
HTML/CSS/JS frontend.

This implementation follows the project's PRD, TRD, and Design Document:
functional requirements, API design, security requirements, visual system,
and prompt templates all map directly to those three documents.

## Project structure

```
documind-ai/
├── app/
│   ├── main.py        # FastAPI app: routes, PDF parsing, Gemini streaming
│   └── prompts.py      # Prompt templates for each action
├── static/
│   ├── index.html      # UI markup (split view desktop / stacked mobile)
│   ├── style.css        # Design system: palette, type, breakpoints
│   └── app.js            # Upload, streaming fetch, copy/download
├── requirements.txt
├── Dockerfile
├── .dockerignore
├── .env.example
└── .gitignore
```

## 1. Get a Gemini API key

Create a free key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).

## 2. Run locally (no Docker)

```bash
cd documind-ai
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env
# edit .env and paste your real GEMINI_API_KEY

export $(cat .env | xargs)      # Windows: set each var manually, or use python-dotenv
uvicorn app.main:app --reload
```

Visit `http://localhost:8000`.

## 3. Run with Docker

```bash
docker build -t documind-ai .
docker run -p 8000:8000 --env-file .env documind-ai
```

Visit `http://localhost:8000`.

## 4. Deploy

### Option A — Render

1. Push this project to a GitHub repo (`.env` stays out of git — check `.gitignore`).
2. On [render.com](https://render.com): **New → Web Service** → connect the repo.
3. Render auto-detects the `Dockerfile`. Leave build/start commands blank.
4. Under **Environment**, add `GEMINI_API_KEY` (and optionally `GEMINI_MODEL`,
   `ALLOWED_ORIGIN`) with your real values.
5. Deploy. Render gives you a public URL like `https://documind-ai.onrender.com`.
6. Free-tier services spin down when idle — hit the URL a minute before your
   demo so it's warm.

### Option B — AWS App Runner

> Note: the original assignment brief specifies AWS deployment specifically
> ("Cloud Deployment & AWS Architecture" is 20% of the grade). Use this path
> if you need to satisfy that requirement.

1. Push the built image to Amazon ECR:
   ```bash
   aws ecr create-repository --repository-name documind-ai
   aws ecr get-login-password | docker login --username AWS --password-stdin <account-id>.dkr.ecr.<region>.amazonaws.com
   docker tag documind-ai:latest <account-id>.dkr.ecr.<region>.amazonaws.com/documind-ai:latest
   docker push <account-id>.dkr.ecr.<region>.amazonaws.com/documind-ai:latest
   ```
2. In the AWS Console, create an **App Runner** service pointing at that ECR image.
3. Under **Environment variables**, set `GEMINI_API_KEY` (never bake it into the image).
4. Choose the smallest free-tier-eligible CPU/memory size.
5. Set up an AWS Budget alert before deploying.
6. App Runner gives you a public HTTPS URL once the service is running.

## 5. Verify before submission

- [ ] Reload the live URL fresh and run all four actions (Summarize, Key
      Points, Ask, Rewrite) end to end.
- [ ] Confirm the page works on a real mobile browser, not just desktop.
- [ ] Open DevTools → Network tab and confirm `GEMINI_API_KEY` never appears
      in any request or response.
- [ ] Confirm `.env` was never committed (`git log --all -- .env`).
- [ ] Paste the live URL into your Project Report and Concept Note.

## Notes on security (per TRD section 6)

- The Gemini API key is read only from the environment (`os.environ`), never
  hardcoded, logged, or returned in a response.
- `.env` is git-ignored; only `.env.example` with placeholder values is committed.
- File uploads are capped at 10 MB and validated as PDF before any Gemini call.
- The backend is the only thing that talks to Gemini — the frontend never
  sees or sends the API key.
