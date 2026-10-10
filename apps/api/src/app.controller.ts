import { Controller, Get } from '@nestjs/common';
import { Public } from './common/auth';

@Controller('')
export class AppController {
  @Get()
  @Public()
  getRoot() {
    return {
      application: 'LandTrack',
      version: '1.3.0',
      region: 'Hyderabad, Telangana',
      status: 'running'
    };
  }
}
