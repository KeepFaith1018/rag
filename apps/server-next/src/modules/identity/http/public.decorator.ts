import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'identity.public';

/** 标记无需访问令牌即可调用的 Controller 或路由。 */
export const Public = () => SetMetadata(IS_PUBLIC, true);
