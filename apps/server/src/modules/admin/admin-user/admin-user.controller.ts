import {
  Controller, Get, Post, Put, Delete,
  Body, Param, Query, UseGuards,
} from '@nestjs/common';
import { AdminUserService } from './admin-user.service';
import { CreateAdminUserDto } from './dto/create-admin-user.dto';
import { UpdateAdminUserDto } from './dto/update-admin-user.dto';
import { AdminAuthGuard } from '../guards/admin-auth.guard';
import { AdminAuth, RequireRole } from '../decorators/admin-auth.decorator';
import { CurrentAdmin } from '../decorators/admin-user.decorator';

@Controller('admin')
@UseGuards(AdminAuthGuard)
@AdminAuth()
@RequireRole('super_admin')
export class AdminUserController {
  constructor(private readonly adminUserService: AdminUserService) {}

  @Get()
  findAll(@Query('page') page?: number, @Query('pageSize') pageSize?: number) {
    return this.adminUserService.findAll(
      page ? Number(page) : 1,
      pageSize ? Number(pageSize) : 20,
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.adminUserService.findOne(id);
  }

  @Post()
  create(
    @Body() dto: CreateAdminUserDto,
    @CurrentAdmin('sub') currentAdminId: string,
  ) {
    return this.adminUserService.create(dto, currentAdminId);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateAdminUserDto,
    @CurrentAdmin('sub') currentAdminId: string,
  ) {
    return this.adminUserService.update(id, dto, currentAdminId);
  }

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @CurrentAdmin('sub') currentAdminId: string,
  ) {
    return this.adminUserService.remove(id, currentAdminId);
  }
}
