// Demo-only in-memory S3 stand-in for the all-in-one Zoho AppSail image. Not durable.
import http from 'node:http';

const objects = new Map();

http.createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const isBucket = path.replace(/^\/+|\/+$/g, '').split('/').length <= 1;
    if (isBucket) {
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(req.method === 'HEAD' ? undefined : '<ListBucketResult/>');
    }
    if (req.method === 'PUT') {
      objects.set(path, { body: Buffer.concat(chunks), type: req.headers['content-type'] ?? 'application/octet-stream' });
      res.writeHead(200, { ETag: '"demo"' });
      return res.end();
    }
    if (req.method === 'DELETE') {
      objects.delete(path);
      res.writeHead(204);
      return res.end();
    }
    const found = objects.get(path);
    if (!found) {
      res.writeHead(404, { 'content-type': 'application/xml' });
      return res.end('<Error><Code>NoSuchKey</Code></Error>');
    }
    res.writeHead(200, { 'content-type': found.type, 'content-length': found.body.length, ETag: '"demo"' });
    res.end(req.method === 'HEAD' ? undefined : found.body);
  });
}).listen(9100, '127.0.0.1');
