import { Module } from '@nestjs/common';
import { KbPermissionGuard } from './kb-permission.guard';
import { KbPermissionService } from './kb-permission.service';

/**
 * 知识库权限基础模块。
 * 统一导出权限 Guard 与权限服务，供知识库、成员、文档、问答等子模块复用。
 */
@Module({
  providers: [KbPermissionService, KbPermissionGuard],
  exports: [KbPermissionService, KbPermissionGuard],
})
export class KbPermissionModule {}
