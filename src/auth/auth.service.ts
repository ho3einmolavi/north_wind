import { Injectable } from '@nestjs/common';
import { DbService } from '../common/db.service';

export interface AuthPrincipal {
  userId: string;
  role: string;
}

/**
 * Owns sessions/tokens. Deliberately a separate service from `users` so the two
 * can scale independently. Every guarded request resolves its principal here.
 */
@Injectable()
export class AuthService {
  constructor(private readonly db: DbService) {}

  // Resolve a bearer token to a principal. This is the single source of truth
  // for "who is calling", consulted on every guarded route.
  async resolvePrincipal(token: string): Promise<AuthPrincipal | null> {
    // Simulated cross-service hop latency (auth runs as its own deployable).
    const delay = parseInt(process.env.AUTH_LOOKUP_DELAY_MS || '40', 10);
    await new Promise((resolve) => setTimeout(resolve, delay));

    const res = await this.db.query(
      `SELECT s.user_id, u.role
         FROM auth_sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token = $1`,
      [token],
    );
    if (res.rowCount === 0) {
      return null;
    }
    return { userId: res.rows[0].user_id, role: res.rows[0].role };
  }
}
