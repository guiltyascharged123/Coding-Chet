export type Provider =
  'demo' | 'openai' | 'gemini' | 'external' | 'codex' | 'ollama' | 'compatible';
export type ProjectStatus = 'ready' | 'running' | 'paused' | 'needs_input' | 'completed';
export type TaskStatus = 'queued' | 'working' | 'review' | 'done' | 'failed';
export type AgentStatus = 'idle' | 'working' | 'waiting';
export type DocumentPack = 'studio' | 'office';
export type Workflow = 'office' | 'software' | 'research' | 'venture' | 'custom';
export type ReasoningEffort = 'low' | 'medium' | 'high';
export interface Meeting {
  id: string;
  projectId: string;
  agenda: string;
  trigger: 'manual' | 'kickoff' | 'checkpoint';
  status: 'gathering' | 'running' | 'completed' | 'failed' | 'cancelled';
  checkpoint: number;
  participants: Agent[];
  contributions: { agentId: string; role: string; content: string; createdAt: number }[];
  summary: string;
  speakerId?: string;
  error?: string;
  createdAt: number;
  completedAt?: number;
}
export type DocumentKind =
  | 'brief'
  | 'project_plan'
  | 'budget'
  | 'risk_register'
  | 'meeting_minutes'
  | 'status_report'
  | 'notes';
export interface Agent {
  id: string;
  name: string;
  role: string;
  specialty: string;
  color: string;
  desk: number;
  goal?: string;
}
export interface Task {
  id: string;
  projectId: string;
  title: string;
  description: string;
  agentId: string;
  dependencies: string[];
  status: TaskStatus;
  requiresApproval: boolean;
  documentKind?: DocumentKind;
  revisions?: number;
  attemptId?: string;
  output: string;
  feedback: string;
  error?: string;
  startedAt?: number;
  completedAt?: number;
  leaseId?: string;
  leaseExpiresAt?: number;
  toolLog?: { id: string; type: string; detail: string; status?: string }[];
  readOnly?: boolean;
}
export interface Project {
  id: string;
  title: string;
  brief: string;
  status: ProjectStatus;
  createdAt: number;
  provider: Provider;
  documentPack?: DocumentPack;
  model?: string;
  planning?: 'template' | 'ai';
  planningStatus?: 'planning' | 'failed' | 'ready';
  planningError?: string;
  workflow?: Workflow;
  team?: Agent[];
  workspaceFolder?: string;
  toolNetwork?: boolean;
  reasoningEffort?: ReasoningEffort;
  meetingPolicy?: { enabled: boolean; everyTasks: number };
  researchEnabled?: boolean;
}
export interface MemoryItem {
  id: string;
  projectId: string;
  content: string;
  status: 'proposed' | 'verified';
  sourceTaskId?: string;
  sourceHash?: string;
  createdAt: number;
  stale?: boolean;
}
export interface CostPolicy {
  allowPaid: boolean;
  maxConcurrent: number;
  maxTasks: number;
  maxRevisions: number;
  maxRequests24h: number;
  maxInputBytes: number;
  maxOutputTokens: number;
  dailyBudgetUsd: number;
  projectBudgetUsd: number;
  rates: Partial<
    Record<
      'openai' | 'gemini' | 'compatible',
      { model: string; inputPerMillion: number; outputPerMillion: number }
    >
  >;
}
export interface Attempt {
  id: string;
  projectId: string;
  taskId?: string;
  provider: Provider;
  model?: string;
  billing?: 'api' | 'subscription' | 'local' | 'external' | 'none';
  phase: 'plan' | 'task' | 'meeting';
  meetingId?: string;
  status: 'running' | 'completed' | 'uncertain' | 'cached' | 'acknowledged';
  createdAt: number;
  reservedUsd: number;
  actualUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  error?: string;
}
export interface Activity {
  id: string;
  projectId: string;
  agentId?: string;
  targetAgentId?: string;
  type: 'system' | 'started' | 'message' | 'completed' | 'approval' | 'error';
  message: string;
  createdAt: number;
}
export interface Approval {
  id: string;
  projectId: string;
  taskId: string;
  question: string;
  status: 'pending' | 'approved' | 'revision';
  feedback?: string;
  createdAt: number;
}
export interface WorkspaceState {
  agents: Agent[];
  projects: Project[];
  tasks: Task[];
  activities: Activity[];
  approvals: Approval[];
  provider: Provider;
  schemaVersion?: number;
  policy?: CostPolicy;
  memory?: MemoryItem[];
  meetings?: Meeting[];
}
export interface RuntimeInfo {
  available: Record<Provider, boolean>;
  models: { openai: string; gemini: string; codex: string; ollama: string; compatible: string };
  diagnostics?: Record<string, string>;
  coding?: { ready: boolean; message: string };
}
export interface Bootstrap {
  state: WorkspaceState;
  runtime: RuntimeInfo;
  attempts?: Attempt[];
}
export const PROVIDER_LABELS: Record<Provider, string> = {
  demo: 'Demo runtime',
  openai: 'OpenAI',
  gemini: 'Gemini',
  external: 'External workers',
  codex: 'Codex · ChatGPT sign-in',
  ollama: 'Local model · Ollama',
  compatible: 'OpenAI-compatible model',
};
export const STATUS_LABELS: Record<ProjectStatus, string> = {
  ready: 'Ready to run',
  running: 'Team is working',
  paused: 'Paused',
  needs_input: 'Your input needed',
  completed: 'Project complete',
};
