// Forwards localhost ports to the Podman machine when WSL does not publish them to Windows.
import net from 'node:net';

const target = process.env.PODMAN_HOST;
if (!target) {
  console.error('Set PODMAN_HOST to the Podman machine IP (podman machine ssh <machine> ip -4 addr show eth0).');
  process.exit(1);
}
const ports = (process.env.PODMAN_PORTS ?? '3001,4001').split(',').map(Number);

for (const port of ports) {
  net
    .createServer((client) => {
      const upstream = net.connect(port, target);
      client.pipe(upstream).pipe(client);
      const close = () => {
        client.destroy();
        upstream.destroy();
      };
      client.on('error', close);
      upstream.on('error', close);
    })
    .listen(port, '127.0.0.1', () => console.log(`localhost:${port} -> ${target}:${port}`));
}
