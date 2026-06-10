import { NextRequest, NextResponse } from 'next/server';
import { checkEmailsForProjects } from '@/lib/email';
import { isAuthorized } from '@/lib/authHelper';

export async function GET(req: NextRequest) {
  try {
    const authSession = await isAuthorized(req);
    if (!authSession) {
      return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
    }

    const projects = await checkEmailsForProjects();
    return NextResponse.json({ success: true, projects });
  } catch (error: any) {
    console.error("Email Fetch Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
