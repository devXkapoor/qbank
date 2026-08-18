import { pgTable, uuid, text, integer, timestamp } from 'drizzle-orm/pg-core';

// Phase 0 keeps the spine minimal: users -> goals -> questions.
// Phase 1 inserts `banks` between goals and questions, and adds
// `attempts` + `review_cards` for spaced repetition.

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const goals = pgTable('goals', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const questions = pgTable('questions', {
  id: uuid('id').primaryKey().defaultRandom(),
  goalId: uuid('goal_id')
    .notNull()
    .references(() => goals.id, { onDelete: 'cascade' }),
  // 'mcq' | 'short' | 'coding' | 'conceptual'
  type: text('type').notNull(),
  // 1 (easiest) .. 5 (hardest)
  difficulty: integer('difficulty').notNull(),
  prompt: text('prompt').notNull(),
  answer: text('answer').notNull(),
  explanation: text('explanation').notNull(),
  tags: text('tags').array().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type NewQuestion = typeof questions.$inferInsert;
