import { execFile, spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);

/** Rootless Docker installs its CLI in ~/bin on Ubuntu. Keep its endpoint local
 * to Workroom; installing the workspace must not switch other Docker projects. */
export function dockerConnection(env = process.env) {
  const childEnv: NodeJS.ProcessEnv = {
    ...env,
    PATH: `${env.PATH || ''}${delimiter}${join(homedir(), 'bin')}`,
  };
  if (env.WORKROOM_DOCKER_HOST) {
    childEnv.DOCKER_HOST = env.WORKROOM_DOCKER_HOST;
    delete childEnv.DOCKER_CONTEXT;
  }
  return { binary: env.WORKROOM_DOCKER_BIN || 'docker', env: childEnv };
}

export function dockerExec(args: string[], options: { timeout?: number } = {}) {
  const connection = dockerConnection();
  return execute(connection.binary, args, { ...options, env: connection.env, encoding: 'utf8' });
}

export function spawnDocker(args: string[]) {
  const connection = dockerConnection();
  return spawn(connection.binary, args, { env: connection.env, stdio: ['pipe', 'pipe', 'pipe'] });
}
