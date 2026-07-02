import { signIn } from "@/auth";

/**
 * Minimal sign-in page. Calling `signIn()` with no provider routes to Auth.js's
 * built-in provider chooser, so this page works regardless of which providers
 * the project has enabled.
 */
export default function SignInPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-6 rounded-lg border border-black/10 p-8 dark:border-white/15">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Sign in</h1>
          <p className="text-sm text-black/60 dark:text-white/60">
            Continue to your account.
          </p>
        </div>
        <form
          action={async () => {
            "use server";
            await signIn(undefined, { redirectTo: "/" });
          }}
        >
          <button
            type="submit"
            className="w-full rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
          >
            Continue
          </button>
        </form>
      </div>
    </main>
  );
}
