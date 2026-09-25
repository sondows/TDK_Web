import { redirect } from "next/navigation";
import { getPrivilegedStaff } from "@/lib/permissions";
import AdminVerifyGate from "../AdminVerifyGate";
import StaffManagementClient from "./StaffManagementClient";
export default async function StaffPage(){const actor=await getPrivilegedStaff();if(!actor)return <AdminVerifyGate title="직원 관리 관리자 확인"/>;if(actor.role!=="OWNER")redirect("/pos");return <StaffManagementClient/>}
