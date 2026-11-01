import { enrollProgramTrust, revokeCurrentProgramTrust, trustStatus } from "@/lib/program-trust-routes";
export const GET = (request: Request) => trustStatus("KDS", request);
export const POST = (request: Request) => enrollProgramTrust(request, "KDS");
export const DELETE = (request: Request) => revokeCurrentProgramTrust(request, "KDS");
