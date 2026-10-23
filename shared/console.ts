export const CONSOLE_LIMITS = {
  entryCharacters: 48000,
  projectEntries: 300,
  projectCharacters: 480000,
  workspaceEntries: 1000,
  workspaceCharacters: 2000000,
};
export type ConsoleEvent = {
  id?: string;
  type: 'request' | 'response' | 'command' | 'tool' | 'status' | 'error';
  text: string;
  status?: string;
};
export type ConsoleEntry = Omit<ConsoleEvent, 'id'> & {
  id: string;
  sequence: number;
  projectId: string;
  taskId?: string;
  taskTitle?: string;
  agentId?: string;
  agentName?: string;
  agentRole?: string;
  attemptId?: string;
  meetingId?: string;
  phase: 'plan' | 'task' | 'meeting';
  provider: string;
  model?: string;
  createdAt: number;
  updatedAt: number;
  truncated?: boolean;
};
