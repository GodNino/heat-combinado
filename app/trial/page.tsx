import { redirect } from "next/navigation";
// "Start free trial" from the public site: the app's sign-up form, set up for a new restaurant.
export default function Trial() {
  redirect("/app?start=trial");
}
