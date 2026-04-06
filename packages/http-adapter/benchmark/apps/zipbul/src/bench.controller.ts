import { RestController, Get } from '@zipbul/http-adapter';

@RestController('')
export class BenchController {
  @Get('/')
  json() {
    return { message: 'Hello, World!' };
  }
}
