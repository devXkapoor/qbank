import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env
const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';

// The shape we force the model to return. This is the single source of truth:
// the JSON schema handed to the model is derived from the same intent, and the
// Zod schema re-validates whatever comes back before it touches the database.
const QuestionSchema = z.object({
  type: z.enum(['mcq', 'short', 'coding', 'conceptual']),
  difficulty: z.number().int().min(1).max(5),
  prompt: z.string().min(1),
  answer: z.string().min(1),
  explanation: z.string().min(1),
  tags: z.array(z.string()).default([]),
});

const GeneratedSchema = z.object({ questions: z.array(QuestionSchema) });
export type GeneratedQuestion = z.infer<typeof QuestionSchema>;

// A tool the model MUST call. Forcing tool_choice gives us structured JSON
// instead of prose we'd have to parse out of a text answer.
const SAVE_TOOL: Anthropic.Tool = {
  name: 'save_questions',
  description: 'Return the generated study questions in structured form.',
  input_schema: {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['mcq', 'short', 'coding', 'conceptual'] },
            difficulty: { type: 'integer', minimum: 1, maximum: 5 },
            prompt: { type: 'string' },
            answer: { type: 'string' },
            explanation: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
          },
          required: ['type', 'difficulty', 'prompt', 'answer', 'explanation', 'tags'],
        },
      },
    },
    required: ['questions'],
  },
};

export async function generateQuestions(
  goalTitle: string,
  goalDescription: string | null,
  count = 5,
): Promise<GeneratedQuestion[]> {
  const context = goalDescription ? `${goalTitle}\n\nContext: ${goalDescription}` : goalTitle;

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    tools: [SAVE_TOOL],
    tool_choice: { type: 'tool', name: 'save_questions' },
    messages: [
      {
        role: 'user',
        content:
          `Generate exactly ${count} high-quality study questions for this goal:\n\n${context}\n\n` +
          `Vary difficulty across 1-5 and mix the question types. For each, give a ` +
          `correct answer, a concise explanation of why, and 1-3 topic tags. ` +
          `Call the save_questions tool with the result.`,
      },
    ],
  });

  const toolUse = message.content.find((b) => b.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('Model did not return structured questions');
  }

  // Never trust the model's JSON blindly — validate before persisting.
  return GeneratedSchema.parse(toolUse.input).questions;
}
