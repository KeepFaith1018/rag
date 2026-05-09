import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Auth } from '@common/decorators/auth.decorator';
import { AuthGuard } from '@common/guards/auth.guard';
import { ChatModelService } from './chat-model.service';
import { TestConnectivityDto } from './dto/test-connectivity.dto';

/**
 * AI 基础能力接口控制器。
 *
 * 提供对话模块所需的 AI 能力接口：
 * - 获取可用的模型配置列表
 */
@Controller('ai')
@UseGuards(AuthGuard)
@Auth()
export class AiController {
  constructor(private readonly chatModelService: ChatModelService) {}

  /**
   * 获取当前用户可用的模型配置列表。
   *
   * 首版返回系统默认模型。后续可扩展为从数据库读取用户自定义配置。
   */
  @Get('model-configs')
  listModelConfigs() {
    const defaultModel = this.chatModelService.getDefaultModelName();

    // 首版返回系统默认模型
    return [
      {
        configId: 'system-default',
        modelName: defaultModel,
        provider: 'system',
        source: 'system' as const,
      },
    ];
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