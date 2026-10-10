import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/auth';

interface HealthResponse {
  status: 'ok';
  service: 'landtrack-api';
  timestamp: string;
}

@Controller('health')
export class HealthController {
  @Get()
  @Public()
  getHealth(): HealthResponse {
    return {
      status: 'ok',
      service: 'landtrack-api',
      timestamp: new Date().toISOString()
    };
  }
}
