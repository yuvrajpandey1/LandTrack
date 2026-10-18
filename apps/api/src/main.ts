import 'dotenv/config';
import { createApiApplication } from './bootstrap';

async function bootstrap() {
  const app = await createApiApplication();
  await app.listen(Number(process.env.PORT ?? 4000));
  console.info(`NRI Land Tracking System API is listening on port ${Number(process.env.PORT ?? 4000)}.`);
}

void bootstrap();
