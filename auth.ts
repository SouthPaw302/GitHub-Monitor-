import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";

export const authConfigured = Boolean(
  process.env.AUTH_SECRET &&
  process.env.AUTH_GITHUB_ID &&
  process.env.AUTH_GITHUB_SECRET,
);

export function authorizedGitHubUsers() {
  return (process.env.MONITOR_AUTHORIZED_USERS || "SouthPaw302")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export function isAuthorizedGitHubLogin(login?: string | null) {
  if (!login) return false;
  return authorizedGitHubUsers().includes(login.toLowerCase());
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: process.env.AUTH_SECRET || "AUTH_DISABLED_UNTIL_CONFIGURED",
  trustHost: true,
  providers: authConfigured
    ? [
        GitHub({
          clientId: process.env.AUTH_GITHUB_ID!,
          clientSecret: process.env.AUTH_GITHUB_SECRET!,
          authorization: {
            params: {
              scope: "read:user user:email",
            },
          },
        }),
      ]
    : [],
  pages: {
    signIn: "/signin",
  },
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider !== "github") return false;
      const candidate = (profile as { login?: unknown } | undefined)?.login;
      const login = typeof candidate === "string" ? candidate : "";
      return isAuthorizedGitHubLogin(login);
    },
    async jwt({ token, profile }) {
      const candidate = (profile as { login?: unknown } | undefined)?.login;
      if (typeof candidate === "string") token.githubLogin = candidate;
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.githubLogin =
          typeof token.githubLogin === "string" ? token.githubLogin : undefined;
      }
      return session;
    },
  },
});
