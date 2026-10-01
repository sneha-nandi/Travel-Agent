"""
Travel Planner Agent — backend
--------------------------------
FastAPI service that turns (destination, duration, budget, interests) into a
structured day-by-day itinerary using Gemini 3.5 Flash-Lite, with Google
Search grounding switched on so hotel/restaurant suggestions are pulled from
current web results rather than the model just vibing.

Run:
    pip install -r requirements.txt
    cp .env.example .env   # then paste your Gemini API key in
    uvicorn app:app --reload --port 8000
"""

import json
import os
from typing import List, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from google import genai
from google.genai import errors as genai_errors
from google.genai import types
from pydantic import BaseModel, Field

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
MODEL_NAME = "gemini-3.5-flash-lite"

app = FastAPI(title="Travel Planner Agent")

# Wide open for local dev. Lock this down to your actual frontend origin
# before you put this anywhere near production.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------- Request/response contracts ----------

class TripRequest(BaseModel):
    destination: str
    duration_days: int = Field(gt=0, le=30)
    budget_amount: float = Field(gt=0)
    budget_currency: str = "INR"
    travelers: int = Field(default=1, ge=1)
    interests: Optional[str] = None  # free text: "food, history, nightlife"
    pace: str = "moderate"           # relaxed | moderate | packed


class TimeBlock(BaseModel):
    time_start: str
    time_end: str
    duration_minutes: int
    location_name: str
    activity: str
    estimated_cost: float
    notes: Optional[str] = None


class PlaceSuggestion(BaseModel):
    name: str
    area: str
    price_range: str   # e.g. "$", "$$", "$$$"
    why: str


class DayPlan(BaseModel):
    day_number: int
    theme: str
    blocks: List[TimeBlock]
    nearby_hotels: List[PlaceSuggestion]
    nearby_restaurants: List[PlaceSuggestion]


class BudgetBreakdown(BaseModel):
    accommodation: float
    food: float
    transport: float
    activities: float
    miscellaneous: float


class Itinerary(BaseModel):
    destination: str
    duration_days: int
    currency: str
    total_budget: float
    budget_breakdown: BudgetBreakdown
    days: List[DayPlan]
    tips: List[str]


# ---------- Gemini call ----------

SYSTEM_INSTRUCTION = """You are a meticulous travel planning agent. Given a \
destination, trip length, budget, and traveler interests, produce a realistic, \
time-boxed day-by-day itinerary.

Rules:
- Every day must be broken into concrete time blocks (morning/afternoon/evening), \
each with a start time, end time, and duration in minutes at that specific location.
- Stay inside the stated budget across the whole trip. Reflect that in budget_breakdown \
and in each block's estimated_cost, in the requested currency.
- For each day, suggest 2-3 real, currently-operating hotels near that day's \
activities (not necessarily where they're staying the whole trip - nearest to that \
day's locations) and 2-3 real, currently-operating restaurants near those locations. \
Use search grounding to keep these current and real, not invented.
- Match pace: relaxed = 2-3 stops/day, moderate = 3-4, packed = 5+.
- Respect stated interests when choosing activities.
- Keep activity descriptions concrete and specific to the destination, not generic \
travel-blog filler.
"""


def build_prompt(req: TripRequest) -> str:
    interests = req.interests or "general sightseeing, food, and culture"
    return (
        f"Plan a {req.duration_days}-day trip to {req.destination} for "
        f"{req.travelers} traveler(s). Total budget: {req.budget_amount} "
        f"{req.budget_currency}. Interests: {interests}. Pace: {req.pace}. "
        f"Return the full itinerary as JSON matching the required schema."
    )


def call_gemini(req: TripRequest) -> dict:
    if not GEMINI_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="GEMINI_API_KEY is not set. Copy .env.example to .env and add your key.",
        )

    client = genai.Client(api_key=GEMINI_API_KEY)

    # Gemini 3-series models support combining Search grounding with a
    # response_schema in the same call. If Google changes that for this
    # model on your account, drop the `tools=` line and the response will
    # still validate — you'll just lose live-web grounding for hotels/food.
    response = client.models.generate_content(
        model=MODEL_NAME,
        contents=build_prompt(req),
        config=types.GenerateContentConfig(
            system_instruction=SYSTEM_INSTRUCTION,
            tools=[types.Tool(google_search=types.GoogleSearch())],
            response_mime_type="application/json",
            response_schema=Itinerary,
        ),
    )

    try:
        return json.loads(response.text)
    except (json.JSONDecodeError, TypeError) as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Gemini returned something that wasn't valid JSON: {exc}",
        )


def call_gemini_safe(req: TripRequest) -> dict:
    """Wraps call_gemini so Google API errors become clean HTTP responses
    instead of unhandled exceptions (which drop CORS headers and make the
    browser report a fake 'can't reach the backend' network error)."""
    try:
        return call_gemini(req)
    except genai_errors.ClientError as exc:
        status = getattr(exc, "status_code", 429)
        if status == 429:
            raise HTTPException(
                status_code=429,
                detail=(
                    "Gemini API quota exceeded (429). You've hit either the "
                    "per-minute or per-day free-tier limit. Check "
                    "https://aistudio.google.com for your exact quota, or "
                    "wait a minute and try once more."
                ),
            )
        raise HTTPException(status_code=status, detail=f"Gemini API error: {exc}")
    except genai_errors.APIError as exc:
        raise HTTPException(status_code=502, detail=f"Gemini API error: {exc}")


# ---------- Routes ----------

@app.get("/api/health")
def health():
    return {"status": "ok", "model": MODEL_NAME}


@app.post("/api/plan", response_model=Itinerary)
def plan_trip(req: TripRequest):
    data = call_gemini_safe(req)
    return data
