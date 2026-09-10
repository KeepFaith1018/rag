import {
  Body,
  Controller,
  Get,
  HttpException,
  INestApplication,
  Post,
  StreamableFile,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { IsString } from 'class-validator';
import { HttpModule } from '@platform/http/http.module';
import { RawResponse } from '@platform/http/response.interceptor';
import { BusinessError } from '@shared/errors/business-error';

class InputDto {
  @IsString() name!: string;
}

@Controller('contract')
class ContractController {
  @Get() data() {
    return { id: 9007199254740993n };
  }
  @Post() input(@Body() input: InputDto) {
    return input;
  }
  @Get('error') error() {
    throw new BusinessError(41011, '知识库非空', 'conflict');
  }
  @Get('unknown') unknown() {
    throw new Error('mysql://user:password@private-host/db');
  }
  @Get('rate') rate() {
    throw new HttpException('Internal limiter details', 429);
  }
  @Get('raw') @RawResponse() raw() {
    return { transport: 'raw' };
  }
  @Get('file') file() {
    return new StreamableFile(Buffer.from('image-bytes'), {
      type: 'application/octet-stream',
    });
  }
}

describe('HTTP boundary through Nest', () => {
  let app: INestApplication;
  let base: string;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [HttpModule],
      controllers: [ContractController],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  });
  afterAll(async () => {
    await app?.close();
  });
  it('wraps once, preserves large IDs and validates request IDs', async () => {
    const response = await fetch(`${base}/api/contract`, {
      headers: { 'x-request-id': 'test-request' },
    });
    expect(response.headers.get('x-request-id')).toBe('test-request');
    expect(await response.json()).toEqual({
      success: true,
      code: 0,
      message: '成功',
      data: { id: '9007199254740993' },
    });
    const invalid = await fetch(`${base}/api/contract`, {
      headers: { 'x-request-id': 'bad value' },
    });
    expect(invalid.headers.get('x-request-id')).toMatch(/^[\w-]+$/);
  });
  it('rejects unknown DTO fields without returning their values', async () => {
    const response = await fetch(`${base}/api/contract`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'valid', password: 'secret-value' }),
    });
    expect(response.status).toBe(400);
    const text = await response.text();
    expect(text).toContain('40000');
    expect(text).not.toContain('secret-value');
  });
  it.each([
    ['error', 409, 41011],
    ['rate', 429, 42900],
    ['unknown', 500, 50000],
    ['missing', 404, 40400],
  ])('maps %s', async (path, status, code) => {
    const response = await fetch(`${base}/api/contract/${path}`);
    expect(response.status).toBe(status);
    const body: unknown = await response.json();
    expect(body).toMatchObject({ success: false, code });
    expect(JSON.stringify(body)).not.toContain('password');
  });
  it('leaves raw and binary transports unwrapped', async () => {
    expect(await (await fetch(`${base}/api/contract/raw`)).json()).toEqual({
      transport: 'raw',
    });
    expect(await (await fetch(`${base}/api/contract/file`)).text()).toBe(
      'image-bytes',
    );
  });
});
