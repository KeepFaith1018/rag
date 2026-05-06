import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { DictService } from './dict.service';
import { CreateDictTypeDto } from './dto/create-dict-type.dto';
import { UpdateDictTypeDto } from './dto/update-dict-type.dto';
import { CreateDictItemDto } from './dto/create-dict-item.dto';
import { UpdateDictItemDto } from './dto/update-dict-item.dto';
import { AdminAuthGuard } from '../guards/admin-auth.guard';
import { AdminAuth } from '../decorators/admin-auth.decorator';

@Controller('dict')
@UseGuards(AdminAuthGuard)
@AdminAuth()
export class DictController {
  constructor(private readonly dictService: DictService) {}

  // 字典类型
  @Get('type')
  findAllTypes() {
    return this.dictService.findAllTypes();
  }

  @Get('type/:code')
  findTypeByCode(@Param('code') code: string) {
    return this.dictService.findTypeByCode(code);
  }

  @Post('type')
  createType(@Body() dto: CreateDictTypeDto) {
    return this.dictService.createType(dto);
  }

  @Put('type/:code')
  updateType(@Param('code') code: string, @Body() dto: UpdateDictTypeDto) {
    return this.dictService.updateType(code, dto);
  }

  @Delete('type/:code')
  deleteType(@Param('code') code: string) {
    return this.dictService.deleteType(code);
  }

  // 字典项
  @Post('item')
  createItem(@Body() dto: CreateDictItemDto) {
    return this.dictService.createItem(dto);
  }

  @Put('item/:id')
  updateItem(@Param('id') id: string, @Body() dto: UpdateDictItemDto) {
    return this.dictService.updateItem(id, dto);
  }

  @Delete('item/:id')
  deleteItem(@Param('id') id: string) {
    return this.dictService.deleteItem(id);
  }
}
