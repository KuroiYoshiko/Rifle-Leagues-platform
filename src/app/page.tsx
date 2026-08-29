import Link from "next/link";

const features = [
  {
    number: "01",
    title: "One clear season view",
    copy: "See fixtures, deadlines, standings, and form without hunting through disconnected screens.",
  },
  {
    number: "02",
    title: "Scores that tell a story",
    copy: "Track every round, understand your trend, and see exactly where the next point can come from.",
  },
  {
    number: "03",
    title: "Less work for clubs",
    copy: "Keep entries, members, and outstanding scores visible so league nights run smoothly.",
  },
];

const standings = [
  { place: "1", name: "Maya Bennett", club: "Northbridge RC", score: "586.4" },
  { place: "2", name: "Daniel Ward", club: "Ashford Marksmen", score: "583.9" },
  { place: "3", name: "Elena Voss", club: "Riverside Target", score: "581.7" },
];

export default function Home() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#f4f6f2]">
      <section className="relative bg-[#103c29] text-white">
        <div className="target-grid absolute inset-0 opacity-60" />
        <nav className="relative z-10 mx-auto flex h-20 max-w-[1440px] items-center justify-between px-5 sm:px-8 lg:px-12" aria-label="Main navigation">
          <Link href="/" className="flex items-center gap-3 font-semibold tracking-[-0.02em]">
            <span className="grid size-9 place-items-center rounded-full border border-white/25 bg-white/10">
              <span className="size-2.5 rounded-full bg-[#e5ff72] shadow-[0_0_0_5px_rgba(229,255,114,.14)]" />
            </span>
            <span className="text-lg">RifleLeagues</span>
          </Link>
          <div className="hidden items-center gap-8 text-sm text-white/72 md:flex">
            <a href="#product" className="transition hover:text-white">Product</a>
            <a href="#for-clubs" className="transition hover:text-white">For clubs</a>
            <a href="#competition" className="transition hover:text-white">Competition</a>
          </div>
          <Link href="/dashboard" className="rounded-full border border-white/22 bg-white/10 px-4 py-2.5 text-sm font-medium transition hover:bg-white hover:text-[#103c29] sm:px-5">
            Open dashboard
          </Link>
        </nav>

        <div className="relative z-10 mx-auto grid max-w-[1440px] gap-12 px-5 pb-20 pt-14 sm:px-8 sm:pb-24 sm:pt-20 lg:grid-cols-[1.12fr_.88fr] lg:items-center lg:gap-16 lg:px-12 lg:pb-28 lg:pt-24">
          <div>
            <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-white/16 bg-white/[.07] px-3.5 py-2 text-xs font-medium uppercase tracking-[0.16em] text-white/75">
              <span className="size-1.5 rounded-full bg-[#e5ff72]" />
              Built for the whole league
            </div>
            <h1 className="max-w-4xl text-[clamp(3.3rem,8vw,7.4rem)] font-semibold leading-[.88] tracking-[-0.065em]">
              Every round
              <span className="block text-[#e5ff72]">matters.</span>
            </h1>
            <p className="mt-8 max-w-xl text-lg leading-8 text-white/68 sm:text-xl">
              A simpler way for shooters, clubs and organisers to manage the whole season.
            </p>
            <div className="mt-10 flex flex-col gap-3 sm:flex-row">
              <Link href="/dashboard" className="inline-flex min-h-12 items-center justify-center rounded-full bg-[#e5ff72] px-6 text-sm font-semibold text-[#103c29] transition hover:bg-white">
                Explore shooter view <span className="ml-3" aria-hidden="true">→</span>
              </Link>
              <Link href="/club" className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/22 px-6 text-sm font-semibold text-white transition hover:bg-white/10">
                View club administration
              </Link>
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-xl lg:max-w-none">
            <div className="target-mark absolute -right-24 -top-36 hidden aspect-square w-[34rem] rounded-full lg:block" />
            <div className="soft-float relative rounded-[2rem] border border-white/12 bg-[#f9faf7] p-3 text-[#17231d] shadow-[0_32px_80px_rgba(0,0,0,.26)] sm:p-5">
              <div className="rounded-[1.4rem] border border-[#dfe5df] bg-white p-5 sm:p-7">
                <div className="flex items-start justify-between gap-5">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#728078]">Premier Division</p>
                    <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] sm:text-3xl">Week 8 standings</h2>
                  </div>
                  <span className="rounded-full bg-[#edf7ee] px-3 py-1.5 text-xs font-semibold text-[#174f36]">Live</span>
                </div>
                <div className="mt-8 space-y-2">
                  {standings.map((shooter) => (
                    <div key={shooter.name} className="grid grid-cols-[2rem_1fr_auto] items-center gap-3 rounded-xl border border-[#e7ebe7] px-3 py-3.5 sm:grid-cols-[2.5rem_1fr_auto] sm:px-4">
                      <span className={`grid size-8 place-items-center rounded-lg text-sm font-semibold ${shooter.place === "1" ? "bg-[#e5ff72] text-[#103c29]" : "bg-[#f1f3f0] text-[#647169]"}`}>{shooter.place}</span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">{shooter.name}</span>
                        <span className="mt-0.5 block truncate text-xs text-[#7a857f]">{shooter.club}</span>
                      </span>
                      <span className="font-mono text-sm font-semibold tabular-nums">{shooter.score}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-6 grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-[#103c29] p-4 text-white">
                    <p className="text-xs text-white/55">Rounds complete</p>
                    <p className="mt-2 text-2xl font-semibold">8 / 12</p>
                  </div>
                  <div className="rounded-xl bg-[#eef1ec] p-4">
                    <p className="text-xs text-[#758078]">Next deadline</p>
                    <p className="mt-2 text-2xl font-semibold">12 days</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="product" className="mx-auto max-w-[1440px] px-5 py-20 sm:px-8 sm:py-28 lg:px-12">
        <div className="grid gap-10 border-b border-[#dce2dc] pb-14 lg:grid-cols-[.8fr_1.2fr] lg:items-end">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#174f36]">A clearer way to compete</p>
          <h2 className="max-w-3xl text-4xl font-semibold leading-[1.04] tracking-[-0.05em] sm:text-5xl lg:text-6xl">
            Less admin. More focus on the next shot.
          </h2>
        </div>
        <div className="grid md:grid-cols-3">
          {features.map((feature) => (
            <article key={feature.number} className="border-b border-[#dce2dc] py-10 md:border-b-0 md:border-r md:px-8 md:py-14 md:first:pl-0 md:last:border-r-0 md:last:pr-0">
              <span className="font-mono text-xs text-[#829087]">{feature.number}</span>
              <h3 className="mt-10 text-xl font-semibold tracking-[-0.025em]">{feature.title}</h3>
              <p className="mt-4 max-w-sm text-sm leading-6 text-[#68746d]">{feature.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="for-clubs" className="mx-auto max-w-[1440px] px-5 pb-20 sm:px-8 sm:pb-28 lg:px-12">
        <div className="grid overflow-hidden rounded-[2rem] bg-[#e4e9e2] lg:grid-cols-2">
          <div className="p-7 sm:p-12 lg:p-16">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#174f36]">Made for club nights</p>
            <h2 className="mt-6 max-w-xl text-4xl font-semibold leading-[1.04] tracking-[-0.05em] sm:text-5xl">Know what needs attention before it becomes urgent.</h2>
            <p className="mt-6 max-w-lg leading-7 text-[#627068]">Membership requests, competition entries, and outstanding scores stay in one calm, structured view.</p>
            <Link href="/club" className="mt-9 inline-flex items-center text-sm font-semibold text-[#174f36]">Explore the club view <span className="ml-3" aria-hidden="true">→</span></Link>
          </div>
          <div className="relative min-h-[28rem] bg-[#174f36] p-6 sm:p-10">
            <div className="target-mark absolute -bottom-32 -right-24 aspect-square w-[31rem] rounded-full opacity-80" />
            <div className="relative grid h-full content-between gap-10 rounded-[1.4rem] border border-white/15 bg-white/[.07] p-6 text-white backdrop-blur-sm sm:p-8">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Northbridge Rifle Club</span>
                <span className="rounded-full bg-[#e5ff72] px-3 py-1.5 text-xs font-semibold text-[#103c29]">All on track</span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-2xl bg-white/10 p-5"><span className="text-xs text-white/55">Members</span><strong className="mt-3 block text-4xl tracking-[-0.04em]">84</strong></div>
                <div className="rounded-2xl bg-white/10 p-5"><span className="text-xs text-white/55">Active teams</span><strong className="mt-3 block text-4xl tracking-[-0.04em]">6</strong></div>
                <div className="col-span-2 rounded-2xl bg-[#e5ff72] p-5 text-[#103c29]"><span className="text-xs opacity-65">Next club deadline</span><strong className="mt-2 block text-xl">Winter Postal · 14 September</strong></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="competition" className="border-t border-[#dce2dc] bg-white">
        <div className="mx-auto flex max-w-[1440px] flex-col items-start justify-between gap-8 px-5 py-16 sm:px-8 md:flex-row md:items-center lg:px-12">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#174f36]">Ready for the season</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em]">See the league from a better angle.</h2>
          </div>
          <Link href="/dashboard" className="inline-flex min-h-12 items-center justify-center rounded-full bg-[#174f36] px-6 text-sm font-semibold text-white transition hover:bg-[#0f3b28]">Open RifleLeagues <span className="ml-3" aria-hidden="true">→</span></Link>
        </div>
      </section>

      <footer className="bg-[#103c29] text-white">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-6 px-5 py-9 text-sm text-white/55 sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-12">
          <span className="font-semibold text-white">RifleLeagues</span>
          <span>Prototype for the next generation of league competition.</span>
        </div>
      </footer>
    </main>
  );
}
