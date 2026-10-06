import { auth, authConfigured } from "@/auth";
import TelemetryDeck from "@/components/TelemetryDeck";

export default async function HomePage() {
  const session = authConfigured ? await auth() : null;
  const operator = session?.user
    ? {
        login: session.user.githubLogin || null,
        name: session.user.name || null,
      }
    : null;

  return <TelemetryDeck authConfigured={authConfigured} operator={operator} />;
}
