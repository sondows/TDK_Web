/** Display only: user agents can be changed by the client and are not device identities. */
export function programTrustClientLabel(request: Request, standalone: boolean) {
  const agent = request.headers.get("user-agent") ?? "";
  const device = /Android/i.test(agent) ? "Android" : /iPhone|iPad/i.test(agent) ? "iOS" :
    /Windows/i.test(agent) ? "Windows PC" : /Macintosh|Mac OS/i.test(agent) ? "Mac" : "기타 기기";
  const browser = /Edg\//i.test(agent) ? "Edge" : /Chrome\//i.test(agent) ? "Chrome" :
    /Firefox\//i.test(agent) ? "Firefox" : /Safari\//i.test(agent) ? "Safari" : "브라우저";
  return `${device} · ${browser} · ${standalone ? "PWA" : "웹"}`;
}
