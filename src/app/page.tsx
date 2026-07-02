export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
        It&apos;s live.
      </h1>
      <p className="max-w-md text-black/60 dark:text-white/60">
        This project was scaffolded with blueprint. Edit{" "}
        <code className="rounded bg-black/5 px-1.5 py-0.5 font-mono text-sm dark:bg-white/10">
          src/app/page.tsx
        </code>{" "}
        to begin.
      </p>
      <a
        href="/signin"
        className="rounded-md bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90"
      >
        Sign in
      </a>
    </main>
  );
}
