import { NextRequest, NextResponse } from "next/server";

const STARRED_SHORTCUT_POST_ID = "5a57a71a-5508-4dcd-bc8e-c8227dffe5b1";

export function proxy(request: NextRequest) {
  const url = request.nextUrl;

  if (
    url.pathname === "/" &&
    url.searchParams.get("starred") === "1" &&
    Array.from(url.searchParams.keys()).length === 1
  ) {
    const target = new URL(`/posts/${STARRED_SHORTCUT_POST_ID}`, request.url);
    return NextResponse.redirect(target, 307);
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/",
};
