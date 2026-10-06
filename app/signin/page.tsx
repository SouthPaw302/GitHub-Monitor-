import Link from "next/link";
import { Github, LockKeyhole, ShieldCheck } from "lucide-react";
import { authConfigured, signIn } from "@/auth";

export default function SignInPage() {
  return (
    <main className="auth-screen">
      <section className="auth-machine">
        <div className="auth-gear"><ShieldCheck size={38} /></div>
        <p className="eyebrow">AEGIS // OPERATOR ACCESS</p>
        <h1>GitHub Authentication</h1>
        <p className="auth-copy">
          Sign in with an authorized GitHub identity to unlock operator-only controls.
          Your browser session never receives the monitor&apos;s Actions-capable server token.
        </p>

        {authConfigured ? (
          <form
            action={async () => {
              "use server";
              await signIn("github", { redirectTo: "/" });
            }}
          >
            <button className="github-auth-primary" type="submit">
              <Github size={19} />
              Authenticate with GitHub
            </button>
          </form>
        ) : (
          <div className="auth-not-configured">
            <LockKeyhole size={18} />
            <div>
              <strong>OAuth configuration pending</strong>
              <span>Add the required AUTH_* environment variables on the deployment.</span>
            </div>
          </div>
        )}

        <Link className="auth-return" href="/">Return to public command deck</Link>
      </section>
    </main>
  );
}
