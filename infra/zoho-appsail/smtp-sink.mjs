// Demo-only SMTP sink: accepts any mail on 127.0.0.1:1025 and writes it to stdout and /tmp/mail.log.
// Used only when no real SMTP_URL is provided, so "Email me a code" works without an email service.
import net from 'node:net';
import { appendFileSync } from 'node:fs';

const port = Number(process.env.SMTP_SINK_PORT ?? 1025);

net.createServer((socket) => {
  let inData = false;
  let buffer = '';
  let message = '';
  const reply = (line) => socket.write(`${line}\r\n`);
  reply('220 landtrack-sink ESMTP');
  socket.on('error', () => {});
  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let index;
    while ((index = buffer.indexOf('\r\n')) !== -1) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      if (inData) {
        if (line === '.') {
          inData = false;
          const entry = `\n===== MAIL ${new Date().toISOString()} =====\n${message}\n`;
          console.log(entry);
          try { appendFileSync('/tmp/mail.log', entry); } catch { /* ignore */ }
          message = '';
          reply('250 queued');
        } else {
          message += `${line}\n`;
        }
        continue;
      }
      const command = line.slice(0, 4).toUpperCase();
      if (command === 'EHLO' || command === 'HELO') reply('250 landtrack-sink');
      else if (command === 'DATA') { inData = true; reply('354 end with <CRLF>.<CRLF>'); }
      else if (command === 'QUIT') { reply('221 bye'); socket.end(); }
      else reply('250 ok');
    }
  });
}).listen(port, '127.0.0.1', () => console.log(`smtp sink listening on ${port}`));
