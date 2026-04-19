import { SetMetadata } from '@nestjs/common';

export const AUTH_KEY = 'needAuth';
export const Auth = () => SetMetadata(AUTH_KEY, true);
