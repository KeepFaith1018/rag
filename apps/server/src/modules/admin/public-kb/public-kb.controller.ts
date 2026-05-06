import { Controller, Get, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { PublicKbService } from './public-kb.service';
import { ListPublicKbDto } from './dto/list-public-kb.dto';
import { UpdatePublicKbStatusDto } from './dto/update-public-kb-status.dto';
import { AdminAuthGuard } from '../guards/admin-auth.guard';
import { AdminAuth } from '../decorators/admin-auth.decorator';

@Controller('public-kb')
@UseGuards(AdminAuthGuard)
@AdminAuth()
export class PublicKbController {
  constructor(private readonly publicKbService: PublicKbService) {}

  @Get()
  findAll(@Query() query: ListPublicKbDto) {
    return this.publicKbService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.publicKbService.findOne(id);
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdatePublicKbStatusDto,
  ) {
    return this.publicKbService.updateStatus(id, dto);
  }
}
