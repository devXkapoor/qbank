# Q&A Bank — Phase 0

The vertical slice: **sign up → create a goal → generate 5 real questions with an LLM → list them.** Deployable as-is. Everything after this (banks, spaced repetition, MCP server, dedup) layers on top of this spine.

## Stack
Fastify + TypeScript · Drizzle ORM + Postgres · Anthropic SDK (tool-use structured output) · Zod validation · JWT auth.

## Setup

```bash
npm install
cp .env.example .env      # then fill in DATABASE_URL, JWT_SECRET, ANTHROPIC_API_KEY
npm run db:push           # creates the tables from src/db/schema.ts
npm run dev               # starts on :3000
```

You need a Postgres somewhere — local, or a free Neon / Supabase / Railway instance. Paste its URL into `DATABASE_URL`.

## Walk the slice

```bash
# 1. Sign up -> get a token
TOKEN=$(curl -s localhost:3000/auth/signup \
  -H 'content-type: application/json' \
  -d '{"email":"you@example.com","password":"supersecret"}' | jq -r .token)

# 2. Create a goal -> get its id
GOAL=$(curl -s localhost:3000/goals \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"title":"Razorpay backend interview","description":"Node.js, system design, databases"}' | jq -r .id)

# 3. Generate questions (this calls the model)
curl -s localhost:3000/goals/$GOAL/generate -X POST \
  -H "authorization: Bearer $TOKEN" | jq

# 4. List them back
curl -s localhost:3000/goals/$GOAL/questions \
  -H "authorization: Bearer $TOKEN" | jq
```

## Endpoints
| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/auth/signup` | – | Create account, return JWT |
| POST | `/auth/login` | – | Return JWT |
| POST | `/goals` | ✓ | Create a goal |
| POST | `/goals/:id/generate` | ✓ | Generate + persist 5 questions |
| GET | `/goals/:id/questions` | ✓ | List a goal's questions |

## What to notice (and put in the "why this was hard" writeup later)
- **Structured output via forced tool-use**, not prose parsing — the model *must* call `save_questions`.
- **Zod re-validates** the model's JSON before it ever hits the database. Never trust generated JSON.
- Ownership is enforced on every goal-scoped route (`getOwnedGoal`), so users can't read each other's data.

## Next (Phase 1)
Insert `banks` between goals and questions; move generation into a **BullMQ + Redis** job with SSE progress; add topic-tree decomposition before generation.
