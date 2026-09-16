import { z } from 'zod';

export const questionOptionSchema = z.object({
  value: z.string(),
  label: z.string(),
  description: z.string().optional(),
});

export const userQuestionSchema = z.object({
  id: z.string(),
  question: z.string(),
  type: z.enum(['radio', 'checkbox']),
  options: z.array(questionOptionSchema).min(2).max(4),
  default: z.union([z.string(), z.array(z.string())]),
  allowOther: z.boolean().optional(),
});

export const activitySubagentSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
});

export const activityEntrySchema = z.object({
  id: z.string(),
  kind: z.enum(['tool_call', 'tool_result', 'diff', 'info']),
  text: z.string(),
  createdAt: z.string(),
  // Opcional: identifica que essa atividade veio de um subagente, não da conversa
  // principal. Quando ausente, a UI trata a entrada como atividade da conversa
  // principal (comportamento anterior, sem regressão).
  subagent: activitySubagentSchema.optional(),
});

export const pendingQuestionSchema = z.object({
  messageId: z.string(),
  questions: z.array(userQuestionSchema),
});

export const conversationStatusSchema = z.enum([
  'idle',
  'queued',
  'streaming',
  'waiting_user',
  'completed',
  'cancelled',
  'error',
  'disconnected',
]);

export const conversationSnapshotSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  status: conversationStatusSchema,
  message: z.object({ role: z.literal('assistant'), content: z.string() }).optional(),
  activity: z.array(activityEntrySchema).optional(),
  pendingQuestion: pendingQuestionSchema.optional(),
  error: z.string().optional(),
});

const conversationOpenedEventSchema = z.object({
  type: z.literal('event'),
  event: z.literal('conversation_opened'),
  payload: z.object({ id: z.string(), title: z.string().optional() }),
});

// Enviado pela extensão logo após conectar, pra identificar a janela/workspace
// quando o usuário tem mais de uma janela conectada ao mesmo tempo.
const connectionInfoEventSchema = z.object({
  type: z.literal('event'),
  event: z.literal('connection_info'),
  payload: z.object({ label: z.string().optional() }),
});

const conversationClosedEventSchema = z.object({
  type: z.literal('event'),
  event: z.literal('conversation_closed'),
  payload: z.object({ id: z.string() }),
});

const snapshotEventSchema = z.object({
  type: z.literal('event'),
  event: z.literal('snapshot'),
  payload: conversationSnapshotSchema,
});

const resultOkSchema = z.object({
  type: z.literal('result'),
  requestId: z.string(),
  ok: z.literal(true),
  result: conversationSnapshotSchema,
});

const resultErrSchema = z.object({
  type: z.literal('result'),
  requestId: z.string(),
  ok: z.literal(false),
  error: z.string(),
});

export const wsInboundMessageSchema = z.union([
  conversationOpenedEventSchema,
  connectionInfoEventSchema,
  conversationClosedEventSchema,
  snapshotEventSchema,
  resultOkSchema,
  resultErrSchema,
]);

export const sendMessageCommandSchema = z.object({
  type: z.literal('command'),
  requestId: z.string(),
  operation: z.literal('send_message'),
  payload: z.object({ id: z.string(), message: z.string().min(1) }),
});

export const stopResponseCommandSchema = z.object({
  type: z.literal('command'),
  requestId: z.string(),
  operation: z.literal('stop_response'),
  payload: z.object({ id: z.string() }),
});

export const answerQuestionCommandSchema = z.object({
  type: z.literal('command'),
  requestId: z.string(),
  operation: z.literal('answer_question'),
  payload: z.object({
    id: z.string(),
    messageId: z.string(),
    answers: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional(),
    skipped: z.boolean().optional(),
  }),
});

export const openConversationCommandSchema = z.object({
  type: z.literal('command'),
  requestId: z.string(),
  operation: z.literal('open_conversation'),
  payload: z.object({}),
});

export type QuestionOption = z.infer<typeof questionOptionSchema>;
export type UserQuestion = z.infer<typeof userQuestionSchema>;
export type ActivitySubagent = z.infer<typeof activitySubagentSchema>;
export type ActivityEntry = z.infer<typeof activityEntrySchema>;
export type PendingQuestion = z.infer<typeof pendingQuestionSchema>;
export type ConversationStatus = z.infer<typeof conversationStatusSchema>;
export type ConversationSnapshot = z.infer<typeof conversationSnapshotSchema>;
export type WsInboundMessage = z.infer<typeof wsInboundMessageSchema>;

type SendMessagePayload = z.infer<typeof sendMessageCommandSchema>['payload'];
type StopResponsePayload = z.infer<typeof stopResponseCommandSchema>['payload'];
type AnswerQuestionPayload = z.infer<typeof answerQuestionCommandSchema>['payload'];

export type AgentCommandInput =
  | { operation: 'send_message'; payload: SendMessagePayload }
  | { operation: 'stop_response'; payload: StopResponsePayload }
  | { operation: 'answer_question'; payload: AnswerQuestionPayload };
