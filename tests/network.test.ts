import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { connect } from 'node:net';
import { spawn } from 'node:child_process';

const listen = (server: Server) =>
  new Promise<number>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve((server.address() as any).port)),
  );
test('Node fetch honors the configured host proxy while NO_PROXY keeps local model requests direct', async () => {
  const target = createServer((_req, res) => res.end('fixture-network-ok'));
  const targetPort = await listen(target);
  let tunnels = 0;
  const proxy = createServer();
  proxy.on('connect', (req, socket, head) => {
    tunnels++;
    assert.equal(req.url, `workroom-proxy-fixture.invalid:${targetPort}`);
    const upstream = connect(targetPort, '127.0.0.1', () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      socket.pipe(upstream);
      upstream.pipe(socket);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
    socket.on('close', () => upstream.destroy());
  });
  const proxyPort = await listen(proxy);
  try {
    const result = await new Promise<{ code: number | null; output: string }>((resolve) => {
      const child = spawn(
        process.execPath,
        [
          '--import',
          'tsx',
          '--input-type=module',
          '-e',
          `import './server/network.ts'; console.log(await (await fetch('http://workroom-proxy-fixture.invalid:${targetPort}/',{signal:AbortSignal.timeout(5000)})).text()); console.log(await (await fetch('http://127.0.0.1:${targetPort}/',{signal:AbortSignal.timeout(5000)})).text());`,
        ],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            HTTP_PROXY: `http://127.0.0.1:${proxyPort}`,
            http_proxy: `http://127.0.0.1:${proxyPort}`,
            NO_PROXY: '127.0.0.1',
            no_proxy: '127.0.0.1',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      let output = '';
      child.stdout.on('data', (chunk) => {
        output += chunk;
      });
      child.stderr.on('data', (chunk) => {
        output += chunk;
      });
      child.on('close', (code) => resolve({ code, output }));
    });
    assert.equal(result.code, 0, result.output);
    assert.equal(result.output.match(/fixture-network-ok/g)?.length, 2);
    assert.equal(tunnels, 1);
  } finally {
    target.closeAllConnections();
    proxy.closeAllConnections();
    await Promise.all([
      new Promise<void>((resolve) => target.close(() => resolve())),
      new Promise<void>((resolve) => proxy.close(() => resolve())),
    ]);
  }
});
