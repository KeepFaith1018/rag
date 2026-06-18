import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { IsString, IsOptional, IsBoolean } from 'class-validator';
import { AuthGuard } from '@common/guards/auth.guard';
import { Auth } from '@common/decorators/auth.decorator';
import { CurrentUser } from '@common/decorators/currentUser.decorator';
import { UserModelConfigService } from './user-model-config.service';

/** 创建模型配置 DTO */
class CreateUserModelDto {
  @IsString()
  provider: string;

  @IsString()
  modelName: string;

  @IsString()
  @IsOptional()
  baseUrl?: string;

  @IsString()
  @IsOptional()
  apiKey?: string;
}

/** 更新模型配置 DTO */
class UpdateUserModelDto {
  @IsString()
  @IsOptional()
  provider?: string;

  @IsString()
  @IsOptional()
  modelName?: string;

  @IsString()
  @IsOptional()
  baseUrl?: string;

  @IsString()
  @IsOptional()
  apiKey?: string;

  @IsOptional()
  isActive?: boolean;
}

/**
 * 用户自定义模型配置 CRUD 控制器。
 *
 * apiKey 在服务端使用 AES-256-GCM 加密后存储，仅在运行时按需解密注入 LLM。
 */
@Controller('user/model-configs')
@UseGuards(AuthGuard)
@Auth()
export class UserModelConfigController {
  constructor(private readonly service: UserModelConfigService) {}

  /** 获取当前用户的所有模型配置（不含 apiKey）。 */
  @Get()
  list(@CurrentUser('sub') userId: string) {
    return this.service.findAll(Number(userId));
  }

  /** 获取单条模型配置详情（不含 apiKey）。 */
  @Get(':id')
  getOne(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.service.findOne(Number(userId), Number(id));
  }

  /** 创建一条模型配置，apiKey 加密入库。 */
  @Post()
  create(@CurrentUser('sub') userId: string, @Body() dto: CreateUserModelDto) {
    return this.service.create(Number(userId), dto);
  }

  /** 更新模型配置，apiKey 若传入则加密覆盖。 */
  @Put(':id')
  update(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateUserModelDto,
  ) {
    return this.service.update(Number(userId), Number(id), dto);
  }

  /** 删除模型配置。 */
  @Delete(':id')
  remove(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.service.remove(Number(userId), Number(id));
  }
}
