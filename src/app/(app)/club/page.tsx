import type { Metadata } from "next";
import {
  Badge,
  Card,
  ProgressBar,
  SectionHeader,
  StatCard,
} from "@/components/ui";

export const metadata: Metadata = {
  title: "Club administration",
};

const actions = [
  { mark: "＋", title: "Add a member", copy: "Create a new club profile" },
  { mark: "↗", title: "Enter scores", copy: "Submit or verify a round" },
  { mark: "→", title: "Manage entries", copy: "Review competition entries" },
];

const scoreEntries = [
  { member: "Oliver Grant", initials: "OG", competition: "Winter Postal · R8", due: "Today", status: "Urgent" },
  { member: "Priya Shah", initials: "PS", competition: "County 50m · R4", due: "2 days", status: "Pending" },
  { member: "Lewis Reid", initials: "LR", competition: "Winter Postal · R8", due: "4 days", status: "Pending" },
  { member: "Hannah Cole", initials: "HC", competition: "Autumn Open", due: "7 days", status: "Draft" },
];

const activity = [
  { initials: "EW", name: "Elliot Webb", action: "submitted 97.1 for Winter Postal Round 8", time: "18 min ago" },
  { initials: "NR", name: "Nadia Ross", action: "joined the Senior A team", time: "1 hr ago" },
  { initials: "TS", name: "Tom Sinclair", action: "approved two membership requests", time: "Yesterday" },
  { initials: "MB", name: "Maya Bennett", action: "recorded a new personal best of 98.4", time: "26 Aug" },
];

const teams = [
  { name: "Senior A", members: "8 / 8", progress: 100, tone: "positive" as const },
  { name: "Senior B", members: "7 / 8", progress: 88, tone: "neutral" as const },
  { name: "Junior Squad", members: "5 / 6", progress: 83, tone: "neutral" as const },
];

export default function ClubDashboard() {
  return (
    <div>
      <div className="mb-8 flex flex-col justify-between gap-5 md:flex-row md:items-end">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium text-[#6f7c74]">
            <span className="size-1.5 rounded-full bg-[#58a36b]" />
            Club status · All systems normal
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.045em] text-[#17231d] sm:text-4xl">
            Northbridge Rifle Club
          </h1>
          <p className="mt-2 text-sm leading-6 text-[#748078]">
            Here is what needs your attention before the next league night.
          </p>
        </div>
        <button type="button" className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[#174f36] px-5 text-sm font-semibold text-white transition hover:bg-[#103c29]">
          Add member <span className="ml-2 text-base" aria-hidden="true">＋</span>
        </button>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total members" value="84" supporting={<><span className="font-semibold text-[#287747]">+6</span> this season</>} accent />
        <StatCard label="Pending requests" value="5" supporting={<>3 have complete details</>} />
        <StatCard label="Active competitions" value="7" supporting={<>Across 4 disciplines</>} />
        <StatCard label="Scores awaiting entry" value="12" supporting={<><span className="font-semibold text-[#a05d26]">4 due this week</span></>} />
      </section>

      <section className="mt-10">
        <SectionHeader title="Quick actions" description="Common club tasks, ready when you need them" />
        <div className="grid gap-3 md:grid-cols-3">
          {actions.map((action, index) => (
            <button
              key={action.title}
              type="button"
              className={`group flex items-center gap-4 rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md sm:p-5 ${index === 0 ? "border-[#174f36] bg-[#174f36] text-white" : "border-[#dfe5df] bg-white"}`}
            >
              <span className={`grid size-11 shrink-0 place-items-center rounded-xl text-lg ${index === 0 ? "bg-white/10 text-[#e5ff72]" : "bg-[#eef2ed] text-[#174f36]"}`}>{action.mark}</span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{action.title}</span>
                <span className={`mt-1 block text-xs ${index === 0 ? "text-white/52" : "text-[#7a857f]"}`}>{action.copy}</span>
              </span>
              <span className={`ml-auto transition group-hover:translate-x-1 ${index === 0 ? "text-white/40" : "text-[#9ca59f]"}`} aria-hidden="true">→</span>
            </button>
          ))}
        </div>
      </section>

      <div className="mt-10 grid gap-8 xl:grid-cols-[1.4fr_.72fr] xl:gap-6">
        <section id="scores" className="min-w-0">
          <SectionHeader
            title="Scores awaiting entry"
            description="Items that need submission or verification"
            action={<button type="button" className="text-xs font-semibold text-[#174f36]">View all →</button>}
          />
          <Card className="overflow-hidden">
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-[#e4e8e4] bg-[#fafbf9] text-[10px] font-semibold uppercase tracking-[0.13em] text-[#8a948e]">
                    <th className="px-5 py-3.5">Member</th>
                    <th className="px-5 py-3.5">Competition</th>
                    <th className="px-5 py-3.5">Due</th>
                    <th className="px-5 py-3.5">Status</th>
                    <th className="px-5 py-3.5 text-right"><span className="sr-only">Open</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#edf0ed]">
                  {scoreEntries.map((entry) => (
                    <tr key={entry.member} className="text-sm transition hover:bg-[#fafbf9]">
                      <td className="px-5 py-4">
                        <span className="flex items-center gap-3 font-semibold">
                          <span className="grid size-8 place-items-center rounded-full bg-[#edf1ec] text-[10px] text-[#536159]">{entry.initials}</span>
                          {entry.member}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-[#68746d]">{entry.competition}</td>
                      <td className="px-5 py-4 text-xs font-semibold text-[#536159]">{entry.due}</td>
                      <td className="px-5 py-4"><Badge tone={entry.status === "Urgent" ? "warning" : "neutral"}>{entry.status}</Badge></td>
                      <td className="px-5 py-4 text-right text-[#9aa39e]">→</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="divide-y divide-[#e8ece8] md:hidden">
              {scoreEntries.map((entry) => (
                <article key={entry.member} className="p-4">
                  <div className="flex items-center gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#edf1ec] text-[10px] font-semibold text-[#536159]">{entry.initials}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{entry.member}</p>
                      <p className="mt-0.5 truncate text-xs text-[#7d8881]">{entry.competition}</p>
                    </div>
                    <Badge tone={entry.status === "Urgent" ? "warning" : "neutral"}>{entry.status}</Badge>
                  </div>
                  <div className="mt-3 flex items-center justify-between rounded-lg bg-[#f4f6f2] px-3 py-2 text-xs">
                    <span className="text-[#808a84]">Due</span>
                    <span className="font-semibold">{entry.due}</span>
                  </div>
                </article>
              ))}
            </div>
          </Card>
        </section>

        <section>
          <SectionHeader title="Competition readiness" description="Team entry completeness" />
          <Card className="p-5 sm:p-6">
            <div className="space-y-6">
              {teams.map((team) => (
                <div key={team.name}>
                  <div className="mb-2.5 flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold">{team.name}</p>
                    <span className="text-xs text-[#77827b]">{team.members}</span>
                  </div>
                  <ProgressBar value={team.progress} />
                </div>
              ))}
            </div>
            <div className="mt-6 rounded-xl bg-[#f2f5f1] p-4">
              <div className="flex items-start gap-3">
                <span className="mt-1 size-2 shrink-0 rounded-full bg-[#d78a37]" />
                <div>
                  <p className="text-xs font-semibold">Two spaces still available</p>
                  <p className="mt-1 text-xs leading-5 text-[#7a857f]">Complete team entries before 14 September.</p>
                </div>
              </div>
            </div>
          </Card>
        </section>
      </div>

      <section id="members" className="mt-10">
        <SectionHeader title="Recent activity" description="Latest changes across your club" />
        <Card className="divide-y divide-[#e9ede9] px-4 sm:px-6">
          {activity.map((item) => (
            <article key={item.name + item.time} className="flex gap-3 py-4 sm:items-center sm:gap-4">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#eaf0e9] text-[10px] font-semibold text-[#536159]">{item.initials}</span>
              <p className="min-w-0 flex-1 text-sm leading-5">
                <strong className="font-semibold">{item.name}</strong>{" "}
                <span className="text-[#68746d]">{item.action}</span>
              </p>
              <span className="shrink-0 text-[11px] text-[#929b96]">{item.time}</span>
            </article>
          ))}
        </Card>
      </section>

      <section id="entries" className="mt-10 overflow-hidden rounded-2xl bg-[#174f36] p-6 text-white sm:p-8">
        <div className="grid gap-7 md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <Badge tone="brand">Next club deadline</Badge>
            <h2 className="mt-4 text-2xl font-semibold tracking-[-0.035em]">Winter Postal team entries close in 12 days.</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/55">Senior B and Junior Squad each have one open place. Confirm the final line-up before scorecards are issued.</p>
          </div>
          <button type="button" className="min-h-11 rounded-xl bg-white px-5 text-sm font-semibold text-[#174f36]">Review entries</button>
        </div>
      </section>
    </div>
  );
}
