import TvManagementClient from "../TvManagementClient";

export default async function TvPlaybackPage({ searchParams }: { searchParams: Promise<{ screen?: string }> }) {
  const candidate = Number((await searchParams).screen);
  return <TvManagementClient mode="playback" initialScreen={Number.isSafeInteger(candidate) && candidate > 0 ? candidate : undefined}
    canIssueTestAuthCode={process.env.NODE_ENV === "development" && process.env.DB_NAME === "TDK_POS_TEST"} />;
}
