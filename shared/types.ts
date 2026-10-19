export type Provider = 'demo' | 'openai' | 'gemini' | 'external';
export type ProjectStatus = 'ready' | 'running' | 'paused' | 'needs_input' | 'completed';
export type TaskStatus = 'queued' | 'working' | 'review' | 'done' | 'failed';
export type AgentStatus = 'idle' | 'working' | 'waiting';
export interface Agent {
  id: string;
  name: string;
  role: string;
  specialty: string;
  color: string;
  desk: number;
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
  output: string;
  feedback: string;
  error?: string;
  startedAt?: number;
  completedAt?: number;
  leaseId?: string;
  leaseExpiresAt?: number;
}
export interface Project {
  id: string;
  title: string;
  brief: string;
  status: ProjectStatus;
  createdAt: number;
  provider: Provider;
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
}
export interface RuntimeInfo {
  available: Record<Provider, boolean>;
  models: { openai: string; gemini: string };
}
export interface Bootstrap {
  state: WorkspaceState;
  runtime: RuntimeInfo;
}
export const PROVIDER_LABELS: Record<Provider, string> = {
  demo: 'Demo runtime',
  openai: 'OpenAI',
  gemini: 'Gemini',
  external: 'External workers',
};
export const STATUS_LABELS: Record<ProjectStatus, string> = {
  ready: 'Ready to run',
  running: 'Team is working',
  paused: 'Paused',
  needs_input: 'Your input needed',
  completed: 'Project complete',
};
