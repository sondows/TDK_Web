import { enrollProgramTrust, revokeCurrentProgramTrust, trustStatus } from "@/lib/program-trust-routes";

export const GET = (request: Request) => trustStatus("HOS", request);
export const POST = (request: Request) => enrollProgramTrust(request, "HOS");
export const DELETE = (request: Request) => revokeCurrentProgramTrust(request, "HOS");
