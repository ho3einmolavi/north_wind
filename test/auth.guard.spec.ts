import { UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '../src/auth/auth.guard';

function ctxFor(headers: Record<string, string>) {
  const req: any = { headers };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    _req: req,
  } as any;
}

describe('AuthGuard', () => {
  it('allows a request with a valid token', async () => {
    const authService = {
      resolvePrincipal: jest
        .fn()
        .mockResolvedValue({ userId: 'g1', role: 'guest' }),
    } as any;
    const guard = new AuthGuard(authService);
    const ctx = ctxFor({ authorization: 'Bearer token-guest1' });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(ctx._req.principal).toEqual({ userId: 'g1', role: 'guest' });
  });

  it('rejects a request with no token', async () => {
    const authService = { resolvePrincipal: jest.fn() } as any;
    const guard = new AuthGuard(authService);
    const ctx = ctxFor({});

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a request with an unknown token', async () => {
    const authService = {
      resolvePrincipal: jest.fn().mockResolvedValue(null),
    } as any;
    const guard = new AuthGuard(authService);
    const ctx = ctxFor({ authorization: 'Bearer nope' });

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
