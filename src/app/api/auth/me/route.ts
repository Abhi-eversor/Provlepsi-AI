import { handleMe } from '@/lib/auth-service';
import { authDependencies } from '@/lib/auth-routes';

export function GET(request: Request) {
  return handleMe(request, authDependencies());
}
