import TvManagementClient from "../TvManagementClient";

export default async function TvImagesPage({ searchParams }: { searchParams: Promise<{ screen?: string }> }) {
  const candidate = Number((await searchParams).screen);
  return <TvManagementClient mode="images" initialScreen={Number.isSafeInteger(candidate) && candidate > 0 ? candidate : undefined} />;
}
