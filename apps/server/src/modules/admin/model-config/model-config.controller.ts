import {
  Controller, Get, Post, Put, Patch, Delete,
  Body, Param, Query, UseGuards,
} from '@nestjs/common';
import { ModelConfigService } from './model-config.service';
import { ListModelConfigDto } from './dto/list-model-config.dto';
import { CreateModelConfigDto } from './dto/create-model-config.dto';
import { UpdateModelConfigDto } from './dto/update-model-config.dto';
import { AdminAuthGuard } from '../guards/admin-auth.guard';
import { AdminAuth } from '../decorators/admin-auth.decorator';

@Controller('admin/model-config')
@UseGuards(AdminAuthGuard)
@AdminAuth()
export class ModelConfigController {
  constructor(private readonly modelConfigService: ModelConfigService) {}

  @Get()
  findAll(@Query() query: ListModelConfigDto) {
    return this.modelConfigService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.modelConfigService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateModelConfigDto) {
    return this.modelConfigService.create(dto);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateModelConfigDto) {
    return this.modelConfigService.update(id, dto);
  }

  @Patch(':id/toggle')
  toggle(@Param('id') id: string) {
    return this.modelConfigService.toggle(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.modelConfigService.remove(id);
  }
}
