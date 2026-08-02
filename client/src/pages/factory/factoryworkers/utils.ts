/**
 * Pure helpers and lookup tables for the FactoryWorkers page.
 *
 * Extracted from FactoryWorkers.tsx during the Phase 4 god-file split.
 */

export const emptyForm = {
  fullName: "",
  fatherName: "",
  motherName: "",
  nationalId: "",
  passportNumber: "",
  dateOfBirth: "",
  gender: "",
  nationality: "",
  maritalStatus: "",
  numberOfChildren: 0,
  phone1: "",
  phone2: "",
  emergencyContactName: "",
  emergencyContactPhone: "",
  address: "",
  city: "",
  country: "",
  position: "",
  department: "",
  dateJoined: "",
  contractStartDate: "",
  contractEndDate: "",
  salaryType: "Monthly",
  baseSalary: "",
  perBaleRate: "",
  perKgRate: "",
  overtimeRate: "",
  shiftType: "",
  payFrequency: "Monthly",
  hourlyRate: "",
  weeklySalary: "",
  biWeeklySalary: "",
  transportAllowance: "",
  visaNumber: "",
  visaExpiry: "",
  workPermitNumber: "",
  workPermitExpiry: "",
  residentialPermit: "",
  residentialPermitExpiry: "",
  bankName: "",
  bankAccountNumber: "",
  paymentMethod: "Cash",
  notes: "",
};

export const AVATAR_COLORS = [
  "bg-blue-100 text-blue-700",
  "bg-purple-100 text-purple-700",
  "bg-emerald-100 text-emerald-700",
  "bg-amber-100 text-amber-700",
  "bg-rose-100 text-rose-700",
  "bg-cyan-100 text-cyan-700",
];

export function getAvatarColor(name: string) {
  let hash = 0;
  for (const c of name) hash = c.charCodeAt(0) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0])
    .join("")
    .toUpperCase();
}
