import { Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '../common/db.service';
import { AuthService } from '../auth/auth.service';

export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  role: string;
}

/**
 * Users is its own module/service, separate from auth. To build a profile we
 * still need the live principal, so we hop into auth for it on each request.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly db: DbService,
    private readonly authService: AuthService,
  ) {}

  // Called by guarded routes to hydrate the acting user. Re-resolves the token
  // through auth (single source of truth) and then loads the profile row.
  async getActingUser(token: string): Promise<UserProfile> {
    const principal = await this.authService.resolvePrincipal(token);
    if (!principal) {
      throw new NotFoundException('user not found');
    }
    const res = await this.db.query(
      `SELECT id, email, display_name, role FROM users WHERE id = $1`,
      [principal.userId],
    );
    if (res.rowCount === 0) {
      throw new NotFoundException('user not found');
    }
    const row = res.rows[0];
    return {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      role: row.role,
    };
  }

  async findById(id: string): Promise<UserProfile | null> {
    const res = await this.db.query(
      `SELECT id, email, display_name, role FROM users WHERE id = $1`,
      [id],
    );
    if (res.rowCount === 0) {
      return null;
    }
    const row = res.rows[0];
    return {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      role: row.role,
    };
  }
}
