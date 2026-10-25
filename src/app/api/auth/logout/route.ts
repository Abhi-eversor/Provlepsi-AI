import { handleLogout } from '@/lib/auth-service';
import { authDependencies } from '@/lib/auth-routes';

export function POST(request: Request) {
  return handleLogout(request, authDependencies());
}
