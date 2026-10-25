import { handleSignup } from '@/lib/auth-service';
import { authDependencies } from '@/lib/auth-routes';

export function POST(request: Request) {
  return handleSignup(request, authDependencies());
}
