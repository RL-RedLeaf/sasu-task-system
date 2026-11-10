import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'sasu:isPublic';
/** 标注后跳过 AuthGuard（仅登录/健康检查） */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
