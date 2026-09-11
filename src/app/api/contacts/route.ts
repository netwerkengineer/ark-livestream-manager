import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized } from '@/lib/authHelper';
import { getContacts, saveContacts, Contact } from '@/lib/contactsStore';

export async function GET(req: NextRequest) {
  const authSession = await isAuthorized(req, undefined, 'freeshow');
  if (!authSession) {
    return NextResponse.json({ error: 'Niet geautoriseerd' }, { status: 401 });
  }

  try {
    return NextResponse.json({ success: true, contacts: getContacts() });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// Replaces the whole contacts list in one go, same "send the whole array
// back" pattern the Settings panel already uses for tuyaPlugs - simpler
// than per-contact CRUD for a list this small that's edited rarely.
export async function POST(req: NextRequest) {
  const authSession = await isAuthorized(req, undefined, 'freeshow');
  if (!authSession) {
    return NextResponse.json({ error: 'Niet geautoriseerd' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const contacts: Contact[] = Array.isArray(body.contacts) ? body.contacts : [];
    saveContacts(contacts);
    return NextResponse.json({ success: true, contacts });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
