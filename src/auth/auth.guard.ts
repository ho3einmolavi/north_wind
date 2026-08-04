import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';

/**
 * Guards every protected route. Resolves the caller's principal via the auth
 * service and attaches it to the request so downstream handlers know who is
 * acting.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const header: string = req.headers['authorization'] || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : header;

    if (!token) {
      throw new UnauthorizedException('missing token');
    }

    const principal = await this.authService.resolvePrincipal(token);
    if (!principal) {
      throw new UnauthorizedException('invalid token');
    }

    req.principal = principal;
    return true;
  }
}
