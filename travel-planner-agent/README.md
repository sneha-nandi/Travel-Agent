# Travel Planner Agent

Give it a destination, days, budget, and vibe — it hands back a day-by-day,
time-boxed itinerary with a budget breakdown and nearby hotels/restaurants
for each day. Powered by **Gemini 3.5 Flash-Lite** with Google Search
grounding switched on, so it's not just improvising hotel names.

No Streamlit. Backend is FastAPI, frontend is plain HTML/CSS/JS — a
"boarding pass" themed UI, because it felt more honest to the subject than
another gray dashboard.

```
travel-planner-agent/
├── backend/
│   ├── app.py            # FastAPI app + Gemini call + JSON schema
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── index.html
│   ├── style.css
│   └── script.js
└── README.md
```

## 1. Backend

```bash
cd backend
python -m venv venv && source venv/bin/activate   # optional but sane
pip install -r requirements.txt
cp .env.example .env
```

Get a free Gemini API key at https://aistudio.google.com/apikey, paste it
into `.env` as `GEMINI_API_KEY`.

```bash
uvicorn app:app --reload --port 8000
```

Check it's alive: `curl http://localhost:8000/api/health`

## 2. Frontend

No build step. Just serve the folder — opening `index.html` directly as a
`file://` URL will hit CORS issues with `fetch`, so use a tiny local server:

```bash
cd frontend
python -m http.server 5500
```

Then open http://localhost:5500. `script.js` points at
`http://localhost:8000` for the API — change `API_BASE` at the top of that
file if you deploy the backend elsewhere.

## How it actually works

1. Frontend posts `{destination, duration_days, budget_amount,
   budget_currency, travelers, interests, pace}` to `POST /api/plan`.
2. Backend builds a prompt from that and calls
   `gemini-3.5-flash-lite` with:
   - a `response_schema` (Pydantic `Itinerary` model) so the output is
     always valid JSON, not markdown-wrapped prose you have to regex out.
   - the built-in `google_search` tool for grounding, so hotel/restaurant
     suggestions are pulled from current results rather than hallucinated.
3. FastAPI validates the model's JSON against the schema and returns it.
4. Frontend renders each day as a boarding-pass "ticket" — time blocks on
   top, nearby hotels/restaurants below the perforation.

## Things worth doing before you actually ship this anywhere

- **Lock down CORS** — `allow_origins=["*"]` in `app.py` is fine for
  localhost, not for prod.
- **Rate-limit `/api/plan`** — it's an unauthenticated endpoint calling a
  paid API; add at minimum a request cap per IP.
- **Cache repeat queries** — same destination/budget/duration combos will
  recur; cache the Gemini response for an hour or so and save yourself the
  token spend.
- **Handle the edge case where Gemini's JSON doesn't validate** — it's rare
  with `response_schema` enforced, but not impossible. Right now that's a
  502 with the raw error; you may want a retry-once-with-lower-temperature
  fallback.
