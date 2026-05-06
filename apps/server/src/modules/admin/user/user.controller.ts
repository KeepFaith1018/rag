import { Controller, Get, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { UserService } from './user.service';
import { ListUserDto } from './dto/list-user.dto';
import { AdminAuthGuard } from '../guards/admin-auth.guard';
import { AdminAuth } from '../decorators/admin-auth.decorator';

@Controller('user')
@UseGuards(AdminAuthGuard)
@AdminAuth()
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get()
  findAll(@Query() query: ListUserDto) {
    return this.userService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.userService.findOne(id);
  }

  @Patch(':id/disable')
  disable(@Param('id') id: string) {
    return this.userService.disable(id);
  }

  @Patch(':id/enable')
  enable(@Param('id') id: string) {
    return this.userService.enable(id);
  }
}
