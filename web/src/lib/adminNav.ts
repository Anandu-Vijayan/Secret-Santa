export const adminNav = (current: "/admin" | "/admin/staff") => [
  { href: "/admin", label: "Dashboard", current: current === "/admin" },
  { href: "/admin/staff", label: "Staff", current: current === "/admin/staff" },
];
