import { BadRequestException, Injectable, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createHash, randomUUID } from 'node:crypto';
import { Socket } from 'node:net';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png']);

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly bucket = process.env.S3_BUCKET!;
  private readonly s3 = new S3Client({
    endpoint: process.env.S3_ENDPOINT!,
    region: process.env.S3_REGION!,
    forcePathStyle: true,
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY!, secretAccessKey: process.env.S3_SECRET_KEY! }
  });

  async onModuleInit(): Promise<void> {
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (error) {
      const status = error && typeof error === 'object' && '$metadata' in error
        ? (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
        : undefined;
      if (status !== 404 && status !== 403) throw new Error(`Cannot connect to private object storage bucket "${this.bucket}".`, { cause: error });
      await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
  }

  async createUpload(storageKey: string, mimeType: string, sizeBytes: number): Promise<string> {
    if (!ALLOWED_MIME.has(mimeType) || !Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > MAX_UPLOAD_BYTES) {
      throw new BadRequestException('Document must be a PDF, JPEG, or PNG no larger than 10 MB.');
    }
    return getSignedUrl(this.s3, new PutObjectCommand({
      Bucket: this.bucket, Key: storageKey, ContentType: mimeType, ContentLength: sizeBytes
    }), { expiresIn: 240 });
  }

  async signDownload(storageKey: string): Promise<string> {
    return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: storageKey }), { expiresIn: 240 });
  }

  async scanObject(storageKey: string, expectedMime: string, expectedSize: number): Promise<{ sha256: string }> {
    const head = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: storageKey }));
    if (head.ContentLength !== expectedSize || expectedSize < 1 || expectedSize > MAX_UPLOAD_BYTES || head.ContentType !== expectedMime) {
      throw new Error('Uploaded object metadata does not match the presigned upload request.');
    }
    const result = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: storageKey }));
    if (!result.Body) throw new Error('Uploaded document could not be read from private storage.');
    const bytes = Buffer.from(await result.Body.transformToByteArray());
    if (bytes.length !== expectedSize || !this.magicMatches(expectedMime, bytes)) throw new Error('Uploaded file content does not match its declared document type.');
    await this.scanWithClamAv(bytes);
    return { sha256: createHash('sha256').update(bytes).digest('hex') };
  }

  async scanAndStore(storageKey: string, mimeType: string, bytes: Buffer): Promise<{ sha256: string }> {
    if (!ALLOWED_MIME.has(mimeType) || bytes.length < 1 || bytes.length > MAX_UPLOAD_BYTES) {
      throw new BadRequestException('Document must be a PDF, JPEG, or PNG no larger than 10 MB.');
    }
    if (!this.magicMatches(mimeType, bytes)) {
      throw new BadRequestException('Uploaded file content does not match its declared document type.');
    }
    await this.scanWithClamAv(bytes);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    await this.s3.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: storageKey,
      Body: bytes,
      ContentLength: bytes.length,
      ContentType: mimeType
    }));
    return { sha256 };
  }

  makeStorageKey(propertyId: string): string {
    return `properties/${propertyId}/${randomUUID()}`;
  }

  private magicMatches(mimeType: string, content: Buffer): boolean {
    if (mimeType === 'application/pdf') return content.length >= 5 && content.subarray(0, 5).equals(Buffer.from('%PDF-'));
    if (mimeType === 'image/jpeg') return content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff;
    return mimeType === 'image/png'
      && content.length >= 8
      && content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }

  private async scanWithClamAv(file: Buffer): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const socket = new Socket();
      const response: Buffer[] = [];
      let responseLength = 0;
      let settled = false;
      const timeout = setTimeout(() => finish(new ServiceUnavailableException('ClamAV scan timed out.')), 20_000);
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        socket.destroy();
        if (error) {
          reject(error);
          return;
        }
        const message = Buffer.concat(response).toString('utf8').replace(/\0/g, '').trim();
        if (/\bOK\b/.test(message)) resolve();
        else if (/\bFOUND\b/.test(message)) reject(new BadRequestException('ClamAV detected malware in the uploaded document.'));
        else reject(new ServiceUnavailableException(`ClamAV returned an unexpected scan result: ${message || 'empty response'}`));
      };
      socket.once('error', (error) => finish(new ServiceUnavailableException('ClamAV is unavailable; document scan could not be completed.', { cause: error })));
      socket.on('data', (chunk: Buffer) => {
        response.push(chunk);
        responseLength += chunk.length;
        if (responseLength > 4096) {
          finish(new ServiceUnavailableException('ClamAV returned an oversized scan response.'));
        } else if (chunk.includes(0) || chunk.includes(10)) {
          finish();
        }
      });
      socket.once('end', () => finish());
      socket.connect(Number(process.env.CLAMAV_PORT ?? 3310), process.env.CLAMAV_HOST!, () => {
        socket.write(Buffer.from('zINSTREAM\0'));
        const length = Buffer.alloc(4);
        length.writeUInt32BE(file.length);
        socket.write(length);
        socket.write(file);
        socket.write(Buffer.alloc(4));
      });
    });
  }
}
