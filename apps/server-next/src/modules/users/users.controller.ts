import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { RuntimeConfig } from '../../platform/config/runtime-config.service';
import { BusinessError } from '../../shared/errors/business-error';
import { ErrorCode } from '../../shared/errors/error-code';
import { parseId } from '../../shared/parse-id';
import type { Principal } from '../identity/contracts/principal';
import { CurrentPrincipal } from '../identity/http/current-principal.decorator';
import { Public } from '../identity/http/public.decorator';
import { UpdateUserDto } from './dto/update-user.dto';
import { AvatarService } from './services/avatar.service';
import { UserProfilesService } from './services/user-profiles.service';

type AvatarUpload = { buffer: Buffer; size: number };

/** 用户资料与头像读写的 HTTP 路由入口。 */
@Controller('users')
export class UsersController {
  constructor(
    private readonly profiles: UserProfilesService,
    private readonly avatars: AvatarService,
    private readonly config: RuntimeConfig,
  ) {}

  @Patch('me')
  update(@CurrentPrincipal() principal: Principal, @Body() dto: UpdateUserDto) {
    return this.profiles.update(parseId(principal.userId), dto);
  }

  @Post('me/avatar')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @CurrentPrincipal() principal: Principal,
    @UploadedFile() file?: AvatarUpload,
  ) {
    if (!file || file.size < 1 || file.size > this.config.avatar.maxBytes)
      throw new BusinessError(
        ErrorCode.PARAM_ERROR,
        '头像文件不合法',
        'validation',
      );
    return this.avatars.update(parseId(principal.userId), file.buffer);
  }

  @Public()
  @Get('avatar/:userId')
  avatar(@Param('userId') userId: string): Promise<StreamableFile> {
    return this.avatars.read(parseId(userId));
  }
}
