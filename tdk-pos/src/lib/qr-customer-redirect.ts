const PUBLIC_ORIGIN = "https://tdkon.myasustor.com";

export function qrCustomerRedirectUrl(request: Request, pathname: string): URL {
  const configured = process.env.QR_PUBLIC_BASE_URL?.trim();
  if (configured) {
    const url = new URL(configured);
    if (url.origin !== PUBLIC_ORIGIN || url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
      throw new Error("QR_PUBLIC_BASE_URL must be https://tdkon.myasustor.com");
    }
  }
  return new URL(pathname, process.env.NODE_ENV === "production" ? PUBLIC_ORIGIN : request.url);
}
