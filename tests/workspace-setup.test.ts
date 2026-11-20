import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'dotenv';
import { dockerConnection } from '../server/docker-runtime.js';
import {
  setupWorkspace,
  saveWorkspaceSettings,
  verifyInstaller,
  workspacePrerequisites,
  workspacePrerequisiteIssue,
} from '../scripts/setup-workspace.js';

const readyInfo = {
  SecurityOptions: ['name=rootless', 'name=seccomp,profile=builtin'],
  CgroupVersion: '2',
  MemoryLimit: true,
  CPUCfsQuota: true,
  PidsLimit: true,
};
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'workroom-setup-'));
  const names = [
    'WORKROOM_DOCKER_BIN',
    'WORKROOM_DOCKER_HOST',
    'WORKROOM_SANDBOX_IMAGE',
    'XDG_RUNTIME_DIR',
  ];
  const previous = names.map((name) => process.env[name]);
  names.forEach((name) => delete process.env[name]);
  const calls: string[][] = [],
    logs: string[] = [];
  const dependencies = {
    platform: 'linux',
    uid: 1000,
    home: '/fixture-user',
    executable: (name: string) => `/fixture-bin/${name}`,
    exists: (_path: string) => false,
    run: async (command: string, args: string[], _inherit?: boolean) => {
      calls.push([command, ...args]);
      if (args[0] === 'info') return JSON.stringify(readyInfo);
      if (args[0] === 'context' && args[1] === 'inspect')
        return 'unix:///run/user/1000/docker.sock';
      return '';
    },
    download: async () => {
      assert.fail('No installer download should be needed');
    },
    refresh: async () => ({
      ready: true,
      message: 'Fixture readiness',
      image: 'workroom-tools:local',
    }),
    smoke: async (_root: string) => {
      calls.push(['isolated-smoke-test']);
    },
    log: (line: string) => {
      logs.push(line);
    },
  };
  return {
    root,
    calls,
    logs,
    dependencies,
    close() {
      names.forEach((name, i) => {
        if (previous[i] === undefined) delete process.env[name];
        else process.env[name] = previous[i];
      });
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test('Ubuntu 20.04 legacy cgroups are distinguished from missing systemd', () => {
  const facts = workspacePrerequisites((path) => path === '/run/systemd/system');
  const issue = workspacePrerequisiteIssue(facts)!;
  assert.equal(facts.systemd, true);
  assert.equal(facts.cgroupV2, false);
  assert.match(issue, /systemd is running, but cgroup v2 is not active/);
  assert.match(issue, /Ubuntu 20.04/);
  assert.ok(!issue.includes('systemd is not running'));
});

test('missing systemd does not incorrectly imply that cgroup v2 is missing', () => {
  const issue = workspacePrerequisiteIssue({ systemd: false, cgroupV2: true })!;
  assert.match(issue, /cgroup v2 is available, but systemd is not running/);
  assert.match(issue, /WSL/);
  assert.equal(workspacePrerequisiteIssue({ systemd: true, cgroupV2: true }), undefined);
});

test('Ubuntu setup builds project tools and persists only its verified connection, preserving model settings (fixture)', async () => {
  const h = fixture();
  try {
    writeFileSync(
      join(h.root, '.env'),
      'AGENT_PROVIDER=compatible\nCOMPATIBLE_API_KEY="retained-test-key"\nWORKROOM_DOCKER_HOST="unix:///old.sock"\n',
    );
    await setupWorkspace(h.root, false, h.dependencies);
    const saved = parse(readFileSync(join(h.root, '.env')));
    assert.equal(saved.AGENT_PROVIDER, 'compatible');
    assert.equal(saved.COMPATIBLE_API_KEY, 'retained-test-key');
    assert.equal(saved.WORKROOM_DOCKER_HOST, 'unix:///run/user/1000/docker.sock');
    assert.equal(saved.WORKROOM_SANDBOX_IMAGE, 'workroom-tools:local');
    if (process.platform !== 'win32')
      assert.equal(statSync(join(h.root, '.env')).mode & 0o777, 0o600);
    assert.ok(
      h.calls.some((call) => call.includes('build') && call.at(-1) === join(h.root, 'sandbox')),
    );
    assert.ok(h.calls.some((call) => call[0] === 'isolated-smoke-test'));
    assert.ok(!h.calls.some((call) => call[0] === 'sudo'));
    assert.ok(!h.logs.join('\n').includes('retained-test-key'));
  } finally {
    h.close();
  }
});

test('an unsupported host stops before downloads, installation, smoke execution or settings changes (fixture)', async () => {
  const h = fixture();
  try {
    h.dependencies.run = async (command, args) => {
      h.calls.push([command, ...args]);
      return JSON.stringify({ ...readyInfo, CPUCfsQuota: false });
    };
    await assert.rejects(
      setupWorkspace(h.root, false, h.dependencies),
      /cgroup.*No agent code was executed/s,
    );
    assert.equal(h.calls.length, 1);
    assert.equal(existsSync(join(h.root, '.env')), false);
    assert.ok(!h.logs.some((line) => line.includes('Setup complete')));
  } finally {
    h.close();
  }
});

test('a failed real-execution verification cannot save ready settings or report completion (fixture)', async () => {
  const h = fixture();
  try {
    const before = 'AGENT_PROVIDER=ollama\n';
    writeFileSync(join(h.root, '.env'), before);
    await assert.rejects(
      setupWorkspace(h.root, false, {
        ...h.dependencies,
        smoke: async () => {
          throw Error('Private project mount failed');
        },
      }),
      /mount failed/,
    );
    assert.equal(readFileSync(join(h.root, '.env'), 'utf8'), before);
    assert.ok(!h.logs.some((line) => line.includes('Setup complete')));
  } finally {
    h.close();
  }
});

test('check mode performs no installation, image build/pull or settings write (fixture)', async () => {
  const h = fixture();
  try {
    await setupWorkspace(h.root, true, h.dependencies);
    assert.ok(
      !h.calls.some(
        (call) => call.includes('build') || call.includes('pull') || call[0] === 'sudo',
      ),
    );
    assert.equal(existsSync(join(h.root, '.env')), false);
    assert.ok(h.calls.some((call) => call[0] === 'isolated-smoke-test'));
  } finally {
    h.close();
  }
});

test('a missing Docker CLI can register the installed rootless tooling and start its own service (fixture)', async () => {
  const h = fixture();
  let installed = false;
  try {
    await setupWorkspace(h.root, false, {
      ...h.dependencies,
      exists: (path) =>
        ['/sys/fs/cgroup/cgroup.controllers', '/run/systemd/system'].includes(String(path)),
      executable: (name) => (name === 'docker' && !installed ? undefined : `/fixture-bin/${name}`),
      run: async (command, args) => {
        h.calls.push([command, ...args]);
        if (command.endsWith('dockerd-rootless-setuptool.sh')) installed = true;
        if (args[0] === 'info') return JSON.stringify(readyInfo);
        return '';
      },
    });
    assert.ok(
      h.calls.some(
        (call) => call[0].endsWith('dockerd-rootless-setuptool.sh') && call.includes('install'),
      ),
    );
    assert.ok(h.calls.some((call) => call.join(' ') === 'systemctl --user start docker'));
    assert.ok(!h.calls.some((call) => call.includes('stop') || call.includes('restart')));
  } finally {
    h.close();
  }
});

test('setup refuses root execution and modified installers; workspace Docker settings do not change global context', async () => {
  assert.throws(
    () => verifyInstaller(Buffer.from('unexpected installer')),
    /checksum.*Nothing was executed/,
  );
  const h = fixture();
  try {
    await assert.rejects(
      setupWorkspace(h.root, false, { ...h.dependencies, uid: 0 }),
      /without sudo/,
    );
    assert.equal(h.calls.length, 0);
    const env = {
      PATH: '/usr/bin',
      WORKROOM_DOCKER_BIN: '/user/bin/docker',
      WORKROOM_DOCKER_HOST: 'unix:///user/docker.sock',
      DOCKER_CONTEXT: 'other-project',
    };
    const chosen = dockerConnection(env);
    assert.equal(chosen.binary, '/user/bin/docker');
    assert.equal(chosen.env.DOCKER_HOST, 'unix:///user/docker.sock');
    assert.equal(chosen.env.DOCKER_CONTEXT, undefined);
    assert.equal(env.DOCKER_CONTEXT, 'other-project');
  } finally {
    h.close();
  }
});

test('rootless registration restores the previous global Docker context (fixture)', async () => {
  const h = fixture();
  let installed = false;
  try {
    await setupWorkspace(h.root, false, {
      ...h.dependencies,
      exists: (path) => ['/sys/fs/cgroup/cgroup.controllers', '/run/systemd/system'].includes(path),
      run: async (command, args) => {
        h.calls.push([command, ...args]);
        if (command.endsWith('dockerd-rootless-setuptool.sh')) installed = true;
        if (args[0] === 'info')
          return JSON.stringify({
            ...readyInfo,
            SecurityOptions: installed
              ? readyInfo.SecurityOptions
              : ['name=seccomp,profile=builtin'],
          });
        if (args.join(' ') === 'context show') {
          assert.equal(process.env.WORKROOM_DOCKER_HOST, undefined);
          return 'existing-project-context';
        }
        return '';
      },
    });
    assert.ok(
      h.calls.some((call) => call.slice(1).join(' ') === 'context use existing-project-context'),
    );
  } finally {
    h.close();
  }
});

test('a modified installer cannot reach shell execution or change saved settings (fixture)', async () => {
  const h = fixture();
  try {
    await assert.rejects(
      setupWorkspace(h.root, false, {
        ...h.dependencies,
        executable: (name) =>
          ['docker', 'dockerd-rootless-setuptool.sh'].includes(name)
            ? undefined
            : `/fixture-bin/${name}`,
        exists: (path) =>
          ['/sys/fs/cgroup/cgroup.controllers', '/run/systemd/system'].includes(path),
        download: async () => Buffer.from('modified upstream installer'),
      }),
      /checksum.*Nothing was executed/,
    );
    assert.ok(!h.calls.some((call) => call[0] === 'sh'));
    assert.equal(existsSync(join(h.root, '.env')), false);
  } finally {
    h.close();
  }
});

test('an unreadable existing Docker context blocks registration instead of overwriting it (fixture)', async () => {
  const h = fixture();
  try {
    await assert.rejects(
      setupWorkspace(h.root, false, {
        ...h.dependencies,
        exists: (path) =>
          ['/sys/fs/cgroup/cgroup.controllers', '/run/systemd/system'].includes(path),
        run: async (command, args) => {
          h.calls.push([command, ...args]);
          if (args[0] === 'info')
            return JSON.stringify({
              ...readyInfo,
              SecurityOptions: ['name=seccomp,profile=builtin'],
            });
          if (args.join(' ') === 'context show') throw Error('Unreadable context');
          return '';
        },
      }),
      /will not replace an unknown Docker configuration/,
    );
    assert.ok(!h.calls.some((call) => call.includes('install') || call[0] === 'sh'));
    assert.equal(existsSync(join(h.root, '.env')), false);
  } finally {
    h.close();
  }
});

test('repeated workspace settings writes preserve the provider and do not duplicate setup keys', () => {
  const h = fixture();
  try {
    const settings = {
      WORKROOM_DOCKER_BIN: '/user path/bin/docker',
      WORKROOM_DOCKER_HOST: 'unix:///run/user/1000/docker.sock',
      WORKROOM_SANDBOX_IMAGE: 'workroom-tools:local',
    };
    writeFileSync(join(h.root, '.env'), '# Keep this comment\nAGENT_PROVIDER=compatible\n');
    saveWorkspaceSettings(h.root, settings);
    saveWorkspaceSettings(h.root, settings);
    const contents = readFileSync(join(h.root, '.env'), 'utf8');
    assert.equal((contents.match(/^WORKROOM_DOCKER_HOST=/gm) || []).length, 1);
    assert.match(contents, /# Keep this comment/);
    assert.equal(parse(contents).WORKROOM_DOCKER_BIN, settings.WORKROOM_DOCKER_BIN);
  } finally {
    h.close();
  }
});
