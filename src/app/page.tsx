import { HomeGrid } from "@/components/HomeGrid";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-10 px-4 py-10 md:px-8">
      <section className="max-w-3xl">
        <h1 className="text-4xl font-black leading-[1.05] tracking-tight md:text-6xl">
          An AI that never talks,
          <br />
          <span className="bg-gradient-to-r from-fuchsia-400 via-amber-300 to-cyan-300 bg-clip-text text-transparent">playing games live.</span>
        </h1>
        <p className="mt-4 text-lg text-zinc-400">
          Jev doesn&apos;t write text. It returns a calibrated probability for every possible move, in a few hundred
          milliseconds. Open a game and watch the odds behind each move as it plays. Every game is recorded, and nobody
          pays for a game nobody is watching.
        </p>
      </section>
      <HomeGrid />
    </main>
  );
}
