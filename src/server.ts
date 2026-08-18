import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db } from './db/client.js';
import { users, goals, questions } from './db/schema.js';
import {
  hashPassword,
  verifyPassword,
  signToken,
  requireAuth,
} from './auth.js';
import { generateQuestions } from './generate.js';

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

app.get('/health', async () => ({ ok: true }));

// --- Auth ---------------------------------------------------------------

const credsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

app.post('/auth/signup', async (req, reply) => {
  const parsed = credsSchema.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
  const { email, password } = parsed.data;

  const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (existing) return reply.code(409).send({ error: 'Email already registered' });

  const [user] = await db
    .insert(users)
    .values({ email, passwordHash: await hashPassword(password) })
    .returning({ id: users.id });

  return { token: signToken(user.id) };
});

app.post('/auth/login', async (req, reply) => {
  const parsed = credsSchema.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
  const { email, password } = parsed.data;

  const user = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return reply.code(401).send({ error: 'Invalid credentials' });
  }
  return { token: signToken(user.id) };
});

// --- Goals --------------------------------------------------------------

const goalSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
});

app.post('/goals', { preHandler: requireAuth }, async (req, reply) => {
  const parsed = goalSchema.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

  const [goal] = await db
    .insert(goals)
    .values({ userId: req.userId!, ...parsed.data })
    .returning();
  return goal;
});

// Helper: fetch a goal that belongs to the current user, or null.
async function getOwnedGoal(goalId: string, userId: string) {
  return db.query.goals.findFirst({
    where: and(eq(goals.id, goalId), eq(goals.userId, userId)),
  });
}

// The Phase 0 payoff: generate real questions and persist them.
app.post('/goals/:id/generate', { preHandler: requireAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  const goal = await getOwnedGoal(id, req.userId!);
  if (!goal) return reply.code(404).send({ error: 'Goal not found' });

  try {
    const generated = await generateQuestions(goal.title, goal.description ?? null, 5);
    const inserted = await db
      .insert(questions)
      .values(generated.map((q) => ({ goalId: goal.id, ...q })))
      .returning();
    return inserted;
  } catch (err) {
    req.log.error(err, 'generation failed');
    return reply.code(502).send({ error: 'Question generation failed, please retry' });
  }
});

app.get('/goals/:id/questions', { preHandler: requireAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  const goal = await getOwnedGoal(id, req.userId!);
  if (!goal) return reply.code(404).send({ error: 'Goal not found' });

  return db.query.questions.findMany({ where: eq(questions.goalId, id) });
});

// --- Start --------------------------------------------------------------

const port = Number(process.env.PORT ?? 3000);
app
  .listen({ port, host: '0.0.0.0' })
  .then(() => app.log.info(`qbank phase0 on :${port}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
