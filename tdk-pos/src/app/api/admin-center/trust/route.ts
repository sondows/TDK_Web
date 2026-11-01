import { enrollProgramTrust, revokeCurrentProgramTrust, trustStatus } from "@/lib/program-trust-routes";
export const GET = (request: Request) => trustStatus("ADM", request);
export const POST = (request: Request) => enrollProgramTrust(request, "ADM");
export const DELETE = (request: Request) => revokeCurrentProgramTrust(request, "ADM");
