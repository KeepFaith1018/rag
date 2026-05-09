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

  @IsOptional()
  isActive?: boolean;
}

/**
 * 用户自定义模型配置 CRUD 控制器。
 *
 * 提供用户对自己保存的模型配置进行增删改查的 REST 接口。
 * 仅限登录用户访问，api_key 不由服务端存储。
 */
@Controller('user/model-configs')
@UseGuards(AuthGuard)
@Auth()
export class UserModelConfigController {
  constructor(private readonly service: UserModelConfigService) {}

  /**
   * 获取当前用户的所有模型配置。
   */
  @Get()
  list(@CurrentUser('sub') userId: string) {
    return this.service.findAll(Number(userId));
  }

  /**
   * 获取单条模型配置详情。
   */
  @Get(':id')
  getOne(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.service.findOne(Number(userId), Number(id));
  }

  /**
   * 创建一条模型配置。
   */
  @Post()
  create(@CurrentUser('sub') userId: string, @Body() dto: CreateUserModelDto) {
    return this.service.create(Number(userId), dto);
  }

  /**
   * 更新一条模型配置。
   */
  @Put(':id')
  update(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateUserModelDto,
  ) {
    return this.service.update(Number(userId), Number(id), dto);
  }

  /**
   * 删除一条模型配置。
   */
  @Delete(':id')
  remove(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.service.remove(Number(userId), Number(id));
  }
}
