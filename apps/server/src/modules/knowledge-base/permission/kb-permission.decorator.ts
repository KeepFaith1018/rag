import { SetMetadata } from '@nestjs/common';
import { KbPermissionRequirement } from '../interfaces/kb-permission.interface';

export const KB_PERMISSION_KEY = 'kbPermission';

/**
 * 为接口声明所需的知识库权限动作。
 */
export function KbPermission(requirement: KbPermissionRequirement) {
  return SetMetadata(KB_PERMISSION_KEY, requirement);
}
