import { SetMetadata } from '@nestjs/common';
export const PUBLIC_ROUTE = Symbol('PublicRoute');
export const PublicRoute = () => SetMetadata(PUBLIC_ROUTE, true);
