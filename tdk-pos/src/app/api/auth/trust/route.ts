import { enrollProgramTrust, revokeCurrentProgramTrust, trustStatus } from "@/lib/program-trust-routes";
export const GET = (request: Request) => trustStatus("POS", request);
export const POST = (request: Request) => enrollProgramTrust(request, "POS");
export const DELETE = (request: Request) => revokeCurrentProgramTrust(request, "POS");
