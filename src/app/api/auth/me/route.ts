import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { verifySessionToken, SESSION_COOKIE } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!session) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  const sql = getSql();
  const [user] = await sql`SELECT id, name, email FROM users WHERE id = ${session.userId}`;
  if (!user) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  return NextResponse.json({ user });
}
