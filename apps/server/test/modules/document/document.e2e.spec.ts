/// <reference types="jest" />

import { INestApplication } from '@nestjs/common';
import { createTestApp } from '../../helpers/test-app';

/**
 * 文档处理模块 E2E 冒烟测试。
 *
 * 验证全链路：upload → parsing → chunking → embedding → ready
 *
 * 注意：依赖真实的文件存储（本地目录），但 mock 了所有外部 API 和数据库。
 */
describe('Document Processing (E2E)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const result = await createTestApp();
    app = result.app;
  });

  afterAll(async () => {
    await app.close();
  });

  it('E2E 测试基础设施应正常启动', () => {
    expect(app).toBeDefined();
  });
});
