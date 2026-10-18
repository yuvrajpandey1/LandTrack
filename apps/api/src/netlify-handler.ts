import serverless from 'serverless-http';
import { createApiApplication } from './bootstrap';

type ExpressHandler = ReturnType<typeof serverless>;

interface FunctionResponse {
  statusCode: number;
  headers?: Record<string, boolean | number | string>;
  multiValueHeaders?: Record<string, ReadonlyArray<boolean | number | string>>;
  body?: string;
  isBase64Encoded?: boolean;
}

let handlerPromise: Promise<ExpressHandler> | undefined;

function isHeaderMap(value: unknown): boolean {
  return value === undefined || (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean')
  );
}

function isMultiValueHeaderMap(value: unknown): boolean {
  return value === undefined || (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entries) => Array.isArray(entries) && entries.every(
      (entry) => typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean'
    ))
  );
}

function isHandlerResponse(value: unknown): value is FunctionResponse {
  return typeof value === 'object' &&
    value !== null &&
    'statusCode' in value &&
    typeof value.statusCode === 'number' &&
    (!('body' in value) || typeof value.body === 'string') &&
    (!('isBase64Encoded' in value) || typeof value.isBase64Encoded === 'boolean') &&
    (!('headers' in value) || isHeaderMap(value.headers)) &&
    (!('multiValueHeaders' in value) || isMultiValueHeaderMap(value.multiValueHeaders));
}

async function createHandler(): Promise<ExpressHandler> {
  const app = await createApiApplication();
  await app.init();
  return serverless(app.getHttpAdapter().getInstance(), { basePath: '/.netlify/functions/api' });
}

async function getHandler(): Promise<ExpressHandler> {
  if (!handlerPromise) {
    handlerPromise = createHandler();
  }
  try {
    return await handlerPromise;
  } catch (error) {
    handlerPromise = undefined;
    throw error;
  }
}

export const handler: (event: Parameters<ExpressHandler>[0], context: Parameters<ExpressHandler>[1]) => Promise<FunctionResponse> = async (event, context) => {
  const expressHandler = await getHandler();
  const response: unknown = await expressHandler(event, context);
  if (!isHandlerResponse(response)) {
    throw new Error('The NRI Land Tracking System API returned an invalid Netlify function response.');
  }
  return response;
};
