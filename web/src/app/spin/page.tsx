import { redirect } from "next/navigation";

// The wheel now lives on the home page, next to the wishlist. Keep old links working.
export default function SpinPage() {
  redirect("/home");
}
