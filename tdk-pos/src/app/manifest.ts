import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { isExternalAdminHost, type ExternalSurface } from "@/lib/host-access";
import { buildAppManifest } from "@/lib/app-manifest";

export const dynamic = "force-dynamic";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const requestHeaders = await headers();
  const external = isExternalAdminHost(requestHeaders.get("host"));
  const surface = requestHeaders.get("x-tdk-external-surface") as ExternalSurface | null;
  return buildAppManifest(surface, external);
}
