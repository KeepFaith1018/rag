import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Auth } from '@common/decorators/auth.decorator';
import { AuthGuard } from '@common/guards/auth.guard';
import { PrismaService } from '@common/prisma/prisma.service';
import { ChatModelService } from './chat-model.service';
import { TestConnectivityDto } from './dto/test-connectivity.dto';

/**
 * AI 基础能力接口控制器。
 *
 * 提供对话模块所需的 AI 能力接口：
 * - 获取可用的模型配置列表（仅 main 类型，light 系统内部自动选用）
 * - 测试模型连通性
 */
@Controller('ai')
@UseGuards(AuthGuard)
@Auth()
export class AiController {
  constructor(
    private readonly chatModelService: ChatModelService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * 获取系统可用的主生成模型列表（仅 main 类型）。
   *
   * light 类型（路由/改写/审计等轻量节点）不在前端暴露，
   * 由 ChatModelService.getLightModelName() 自动选用。
   */
  @Get('model-configs')
  async listModelConfigs() {
    const rows = await this.prisma.sys_model_configs.findMany({
      where: { type: 'main', is_active: true },
      orderBy: [{ is_default: 'desc' }, { created_at: 'desc' }],
    });

    if (rows.length === 0) {
      // 兜底：DB 无数据时返回 .env 默认模型
      return [
        {
          configId: 'system-default',
          modelName: this.chatModelService.getDefaultModelName(),
          provider: 'system',
          source: 'system' as const,
          isActive: true,
        },
      ];
    }

    return rows.map((r) => ({
      configId: String(r.id),
      modelName: r.name,
      provider: r.provider,
      source: 'system' as const,
      isActive: true,
    }));
  }

  /**
   * 测试模型连通性。
   *
   * 使用给定的模型配置发起一次简单调用，验证能否正常连接模型服务商。
   */
  @Post('test-connectivity')
  async testConnectivity(
    @Body() dto: TestConnectivityDto,
  ): Promise<{ success: boolean; latencyMs: number }> {
    return this.chatModelService.testConnectivity(dto);
  }
}