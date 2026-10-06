import Link from "next/link";
import { LogOut } from "lucide-react";
import { signOut } from "@/auth";

export default function SignOutPage() {
  return (
    <main className="auth-screen">
      <section className="auth-machine">
        <div className="auth-gear"><LogOut size={36} /></div>
        <p className="eyebrow">AEGIS // OPERATOR ACCESS</p>
        <h1>End GitHub Session</h1>
        <p className="auth-copy">
          This signs the operator out of AEGIS. It does not revoke the GitHub OAuth grant.
        </p>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/" });
          }}
        >
          <button className="github-auth-primary danger-auth" type="submit">
            <LogOut size={18} />
            Sign out
          </button>
        </form>
        <Link className="auth-return" href="/">Cancel</Link>
      </section>
    </main>
  );
}
