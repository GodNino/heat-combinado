import { redirect } from "next/navigation";
// The app itself shows the sign-in form to anyone who is signed out.
export default function Login() {
  redirect("/app");
}
