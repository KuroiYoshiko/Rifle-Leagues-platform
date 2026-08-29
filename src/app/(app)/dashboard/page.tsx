import type { Metadata } from "next";
import Link from "next/link";
import {
  Badge,
  Card,
  ProgressBar,
  SectionHeader,
  StatCard,
} from "@/components/ui";

export const metadata: Metadata = {
  title: "Shooter dashboard",
};

const recentRounds = [
  { round: "Round 8", date: "26 Aug 2026", venue: "Northbridge", score: "98.4", result: "1st", change: "+1.2" },
  { round: "Round 7", date: "12 Aug 2026", venue: "Ashford", score: "96.8", result: "3rd", change: "+0.3" },
  { round: "Round 6", date: "29 Jul 2026", venue: "Riverside", score: "97.2", result: "2nd", change: "+0.7" },
  { round: "Round 5", date: "15 Jul 2026", venue: "Northbridge", score: "95.9", result: "4th", change: "−0.5" },
];

const deadlines = [
  { day: "14", month: "SEP", title: "Premier Division · Round 9", detail: "Score submission closes at 20:00", tone: "brand" as const },
  { day: "28", month: "SEP", title: "County 50m Postal · Round 4", detail: "Card must be witnessed and entered", tone: "neutral" as const },
  { day: "05", month: "OCT", title: "Autumn Open entries", detail: "Individual entries close", tone: "neutral" as const },
];

const formScores = [94.8, 95.6, 95.9, 97.2, 96.8, 98.4];

export default function ShooterDashboard() {
  return (
    <div>
      <div className="mb-8 flex flex-col justify-between gap-5 md:flex-row md:items-end">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium text-[#6f7c74]">
            <span className="size-1.5 rounded-full bg-[#58a36b]" />
            2026 outdoor season
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.045em] text-[#17231d] sm:text-4xl">
            Good afternoon, Maya.
          </h1>
          <p className="mt-2 text-sm leading-6 text-[#748078]">
            Your strongest round of the season moved you into the top three.
          </p>
        </div>
        <button
          type="button"
          className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[#174f36] px-5 text-sm font-semibold text-white transition hover:bg-[#103c29] md:self-auto"
        >
          Enter a score <span className="ml-2 text-base" aria-hidden="true">＋</span>
        </button>
      </div>

      <section className="grid gap-4 xl:grid-cols-[1.45fr_.55fr]">
        <Card className="relative overflow-hidden border-0 bg-[#174f36] p-6 text-white sm:p-8">
          <div className="target-mark absolute -right-28 -top-32 aspect-square w-[31rem] opacity-20" />
          <div className="relative flex h-full flex-col justify-between gap-12">
            <div className="flex flex-wrap items-start justify-between gap-5">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="brand">Current league</Badge>
                  <span className="text-xs text-white/52">10m Air Rifle</span>
                </div>
                <h2 className="mt-5 max-w-xl text-2xl font-semibold tracking-[-0.04em] sm:text-3xl">
                  National Winter Postal League
                </h2>
                <p className="mt-2 text-sm text-white/55">Premier Division · Individual</p>
              </div>
              <div className="rounded-2xl border border-white/12 bg-white/[.08] px-5 py-4 text-right backdrop-blur-sm">
                <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-white/45">Current position</p>
                <p className="mt-1.5 text-3xl font-semibold tracking-[-0.04em]">3<span className="text-base text-white/55">rd</span></p>
              </div>
            </div>
            <div>
              <div className="mb-3 flex items-center justify-between text-xs">
                <span className="text-white/55">Season progress</span>
                <span className="font-semibold text-white">8 of 12 rounds</span>
              </div>
              <ProgressBar value={67} light />
              <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs text-white/52">
                <span>Leading score <strong className="text-white">786.8</strong></span>
                <span>Your total <strong className="text-white">781.4</strong></span>
                <span>Gap <strong className="text-[#e5ff72]">5.4 pts</strong></span>
              </div>
            </div>
          </div>
        </Card>

        <Card className="flex flex-col justify-between p-6 sm:p-7">
          <div>
            <p className="text-xs font-medium text-[#748078]">Next score deadline</p>
            <div className="mt-5 flex items-end justify-between gap-5">
              <div>
                <p className="text-5xl font-semibold tracking-[-0.055em] text-[#17231d]">12</p>
                <p className="mt-1 text-sm font-medium text-[#657169]">days remaining</p>
              </div>
              <span className="rounded-xl bg-[#f1f4ef] px-3 py-2 font-mono text-xs font-semibold text-[#174f36]">14 SEP</span>
            </div>
          </div>
          <div className="mt-8 border-t border-[#e3e8e3] pt-5">
            <p className="text-sm font-semibold">Premier Division · Round 9</p>
            <p className="mt-1.5 text-xs leading-5 text-[#7a857f]">Your score must be witnessed before submission.</p>
          </div>
        </Card>
      </section>

      <section id="statistics" className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Average score"
          value="97.2"
          supporting={<><span className="font-semibold text-[#287747]">↑ 0.8</span> from last season</>}
        />
        <StatCard
          label="Personal best"
          value="98.4"
          supporting={<>Set in Round 8 · Northbridge</>}
        />
        <StatCard
          label="Season improvement"
          value="+2.6%"
          supporting={<>Your form is trending upward</>}
        />
      </section>

      <div className="mt-10 grid gap-8 xl:grid-cols-[1.45fr_.75fr] xl:gap-6">
        <section id="results" className="min-w-0">
          <SectionHeader
            title="Recent rounds"
            description="Your latest submitted and verified scores"
            action={<Link href="/dashboard#results" className="text-xs font-semibold text-[#174f36]">View all →</Link>}
          />
          <Card className="overflow-hidden">
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-[#e4e8e4] bg-[#fafbf9] text-[10px] font-semibold uppercase tracking-[0.13em] text-[#8a948e]">
                    <th className="px-5 py-3.5">Round</th>
                    <th className="px-5 py-3.5">Venue</th>
                    <th className="px-5 py-3.5">Score</th>
                    <th className="px-5 py-3.5">Result</th>
                    <th className="px-5 py-3.5 text-right">Form</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#edf0ed]">
                  {recentRounds.map((round) => (
                    <tr key={round.round} className="text-sm transition hover:bg-[#fafbf9]">
                      <td className="px-5 py-4">
                        <span className="block font-semibold text-[#26332c]">{round.round}</span>
                        <span className="mt-1 block text-xs text-[#89928d]">{round.date}</span>
                      </td>
                      <td className="px-5 py-4 text-[#68746d]">{round.venue}</td>
                      <td className="px-5 py-4 font-mono font-semibold tabular-nums">{round.score}</td>
                      <td className="px-5 py-4"><Badge tone={round.result === "1st" ? "brand" : "neutral"}>{round.result}</Badge></td>
                      <td className={`px-5 py-4 text-right text-xs font-semibold ${round.change.startsWith("+") ? "text-[#287747]" : "text-[#a05d26]"}`}>{round.change}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="divide-y divide-[#e8ece8] md:hidden">
              {recentRounds.map((round) => (
                <article key={round.round} className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold">{round.round} · {round.venue}</p>
                      <p className="mt-1 text-xs text-[#88928c]">{round.date}</p>
                    </div>
                    <Badge tone={round.result === "1st" ? "brand" : "neutral"}>{round.result}</Badge>
                  </div>
                  <div className="mt-4 flex items-end justify-between rounded-xl bg-[#f4f6f2] px-4 py-3">
                    <div><span className="block text-[10px] uppercase tracking-wider text-[#8a948e]">Score</span><strong className="mt-1 block font-mono text-lg">{round.score}</strong></div>
                    <span className={`text-xs font-semibold ${round.change.startsWith("+") ? "text-[#287747]" : "text-[#a05d26]"}`}>{round.change}</span>
                  </div>
                </article>
              ))}
            </div>
          </Card>
        </section>

        <section id="competitions">
          <SectionHeader title="Upcoming deadlines" description="The next dates on your calendar" />
          <Card className="p-3">
            <div className="divide-y divide-[#e7ebe7]">
              {deadlines.map((deadline) => (
                <article key={deadline.title} className="flex gap-4 px-2 py-4 first:pt-2 last:pb-2">
                  <div className={`grid size-12 shrink-0 place-items-center rounded-xl text-center ${deadline.tone === "brand" ? "bg-[#e5ff72] text-[#173e2c]" : "bg-[#f0f3ef] text-[#5f6e65]"}`}>
                    <span><strong className="block text-base leading-4">{deadline.day}</strong><span className="text-[9px] font-bold tracking-wider">{deadline.month}</span></span>
                  </div>
                  <div className="min-w-0 pt-0.5">
                    <p className="text-sm font-semibold leading-5">{deadline.title}</p>
                    <p className="mt-1 text-xs leading-5 text-[#7a857f]">{deadline.detail}</p>
                  </div>
                </article>
              ))}
            </div>
          </Card>
        </section>
      </div>

      <section className="mt-10">
        <SectionHeader title="Six-round form" description="Score consistency across your most recent rounds" />
        <Card className="p-5 sm:p-7">
          <div className="flex h-44 items-end gap-3 sm:gap-5">
            {formScores.map((score, index) => {
              const height = 42 + (score - 94) * 11;
              return (
                <div key={score} className="flex h-full flex-1 flex-col justify-end gap-2">
                  <span className="text-center font-mono text-[10px] text-[#748078]">{score}</span>
                  <div className={`mx-auto w-full max-w-16 rounded-t-lg ${index === formScores.length - 1 ? "bg-[#174f36]" : "bg-[#dce6dc]"}`} style={{ height: `${height}%` }} />
                  <span className="text-center text-[10px] text-[#9aa39e]">R{index + 3}</span>
                </div>
              );
            })}
          </div>
        </Card>
      </section>
    </div>
  );
}
