type CompetitionRoundCutoff = {
  deadline: string;
  shoot_by_date: string | null;
};

export function getCompetitionRoundLocalCutoff(
  round: CompetitionRoundCutoff,
) {
  return round.shoot_by_date ?? round.deadline;
}

export function isCompetitionRoundWithinLocalCutoff(
  round: CompetitionRoundCutoff,
  databaseToday: string,
) {
  return databaseToday <= getCompetitionRoundLocalCutoff(round);
}
