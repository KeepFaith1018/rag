import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AuditLogService } from './audit-log.service';
import { ListAuditLogDto } from './dto/list-audit-log.dto';
import { AdminAuthGuard } from '../guards/admin-auth.guard';
import { AdminAuth } from '../decorators/admin-auth.decorator';

@Controller('admin/audit-log')
@UseGuards(AdminAuthGuard)
@AdminAuth()
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get()
  findAll(@Query() query: ListAuditLogDto) {
    return this.auditLogService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.auditLogService.findOne(id);
  }
}
