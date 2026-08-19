import { NextRequest, NextResponse } from 'next/server';
import { createShowObject } from '@/lib/freeshow';
import { isAuthorized } from '@/lib/authHelper';

export async function POST(req: NextRequest) {
  try {
    const authSession = await isAuthorized(req, undefined, "freeshow");
    if (!authSession) {
      return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
    }

    const { text, category, name } = await req.json();
    if (!text || !text.trim()) {
      return NextResponse.json({ error: 'Geen tekst opgegeven' }, { status: 400 });
    }

    const showObj = createShowObject({
      data: { name: name || '', category: category || 'song', text }
    });

    const activeLayoutId = showObj.settings.activeLayout;
    const layoutSlides = showObj.layouts[activeLayoutId].slides;

    const slides = layoutSlides.map((layoutSlide: any) => ({
      id: layoutSlide.id,
      nextTimer: layoutSlide.nextTimer || 10,
      slideObj: showObj.slides[layoutSlide.id]
    }));

    return NextResponse.json({ success: true, slides });
  } catch (error: any) {
    console.error("Parse lyrics error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
