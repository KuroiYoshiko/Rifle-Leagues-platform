import { Badge } from "@/components/ui";
import {
  getLeagueSeasonPhaseLabel,
  type LeagueSeasonPresentationPhase,
} from "@/lib/league-seasons";

const phaseTones: Record<
  LeagueSeasonPresentationPhase,
  "neutral" | "positive" | "brand"
> = {
  upcoming: "brand",
  ongoing: "positive",
  completed: "neutral",
};

export function LeagueSeasonPhaseBadge({
  phase,
}: {
  phase: LeagueSeasonPresentationPhase;
}) {
  return <Badge tone={phaseTones[phase]}>{getLeagueSeasonPhaseLabel(phase)}</Badge>;
}
