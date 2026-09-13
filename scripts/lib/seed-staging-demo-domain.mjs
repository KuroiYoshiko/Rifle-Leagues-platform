const chunk = (rows, size = 500) => Array.from(
  { length: Math.ceil(rows.length / size) },
  (_, index) => rows.slice(index * size, (index + 1) * size),
);

async function insertChunks(tx, table, rows, columns, returning = false) {
  const results = [];
  for (const batch of chunk(rows)) {
    if (batch.length === 0) continue;
    const inserted = returning
      ? await tx`insert into ${tx(table)} ${tx(batch, ...columns)} returning *`
      : await tx`insert into ${tx(table)} ${tx(batch, ...columns)}`;
    results.push(...inserted);
  }
  return results;
}

const scalar = (value) => String(value);
const instantKey = (value) => new Date(value).toISOString();

export async function seedStagingDemoDomain(sql, model) {
  const summary = await sql.begin(async (tx) => {
    await tx`select pg_catalog.set_config('request.jwt.claim.sub', ${model.showcaseUserId}, true)`;
    await tx`set constraints all deferred`;

    const profileRows = model.shooters.map((shooter) => ({
      id: shooter.authId,
      first_name: shooter.firstName,
      last_name: shooter.lastName,
      title: shooter.index % 9 === 0 ? "Dr" : shooter.index % 2 === 0 ? "Mr" : "Ms",
      town: model.organisations.find((organisation) => organisation.key === shooter.organisationKey)
        .clubs.find((club) => club.localKey === shooter.clubKey).town,
      county: model.organisations.find((organisation) => organisation.key === shooter.organisationKey)
        .clubs.find((club) => club.localKey === shooter.clubKey).county,
    }));
    for (const batch of chunk(profileRows)) {
      await tx`
        insert into public.profiles ${tx(batch, "id", "first_name", "last_name", "title", "town", "county")}
        on conflict (id) do update set
          first_name = excluded.first_name,
          last_name = excluded.last_name,
          title = excluded.title,
          town = excluded.town,
          county = excluded.county
      `;
    }

    const organisationRows = model.organisations.map((organisation) => ({
      name: organisation.name, slug: organisation.slug, short_name: organisation.shortName,
      description: organisation.description, website: organisation.website,
      contact_email: organisation.email, status: "active", organisation_type: organisation.type,
      address: organisation.address, postcode: organisation.postcode,
      telephone: organisation.telephone, about_content: organisation.about,
    }));
    const insertedOrganisations = await tx`
      insert into public.organisations ${tx(organisationRows,
        "name", "slug", "short_name", "description", "website", "contact_email", "status",
        "organisation_type", "address", "postcode", "telephone", "about_content")}
      returning id, slug
    `;
    const organisationId = new Map(insertedOrganisations.map((row) => [row.slug, row.id]));
    const organisationIdByKey = new Map(model.organisations.map((organisation) => [
      organisation.key, organisationId.get(organisation.slug),
    ]));

    const shooterByKey = new Map(model.shooters.map((shooter) => [shooter.key, shooter]));
    const organisationStaff = [];
    for (const organisation of model.organisations) {
      const members = model.shooters.filter((shooter) => shooter.organisationKey === organisation.key);
      const owner = organisation.key === "eastern" ? shooterByKey.get("showcase") : members[0];
      const manager = members.find((shooter) => shooter.key !== owner.key);
      organisationStaff.push(
        { organisation_id: organisationIdByKey.get(organisation.key), user_id: owner.authId, role: "owner", status: "active" },
        { organisation_id: organisationIdByKey.get(organisation.key), user_id: manager.authId, role: "manager", status: "active" },
      );
    }
    await insertChunks(tx, "public.organisation_staff", organisationStaff,
      ["organisation_id", "user_id", "role", "status"]);

    const organisationCards = model.organisations.flatMap((organisation) => organisation.cards.map((card, index) => ({
      organisation_id: organisationIdByKey.get(organisation.key), title: card[0], content: card[1],
      position: index + 1, created_by: model.showcaseUserId, updated_by: model.showcaseUserId,
    })));
    await insertChunks(tx, "public.organisation_information_cards", organisationCards,
      ["organisation_id", "title", "content", "position", "created_by", "updated_by"]);

    const allClubs = model.organisations.flatMap((organisation) => organisation.clubs);
    const clubRows = allClubs.map((club) => ({
      name: club.name, slug: club.slug, town: club.town, county: club.county,
      postcode: club.postcode, website: club.website, status: "active", about_content: club.about,
    }));
    const insertedClubs = await tx`
      insert into public.clubs ${tx(clubRows,
        "name", "slug", "town", "county", "postcode", "website", "status", "about_content")}
      returning id, slug
    `;
    const clubIdBySlug = new Map(insertedClubs.map((row) => [row.slug, row.id]));
    const clubIdByKey = new Map(allClubs.map((club) => [club.key, clubIdBySlug.get(club.slug)]));

    const clubCards = allClubs.map((club) => ({
      club_id: clubIdByKey.get(club.key), title: "Club programme",
      content: `${club.name} publishes practice nights and league team selections through the Club committee.`,
      position: 1, created_by: model.showcaseUserId, updated_by: model.showcaseUserId,
    }));
    await insertChunks(tx, "public.club_information_cards", clubCards,
      ["club_id", "title", "content", "position", "created_by", "updated_by"]);

    const membershipRows = [];
    for (const organisation of model.organisations) {
      for (const club of organisation.clubs) {
        const members = model.shooters.filter((shooter) => shooter.organisationKey === organisation.key
          && shooter.clubKey === club.localKey);
        for (const [index, shooter] of members.entries()) {
          const role = club.localKey === "basildon" && shooter.showcase ? "owner"
            : index === 0 ? "owner" : index === 1 ? "official" : "member";
          membershipRows.push({
            club_id: clubIdByKey.get(club.key), user_id: shooter.authId,
            status: "active", role,
          });
        }
      }
    }
    const insertedMemberships = await insertChunks(tx, "public.club_memberships", membershipRows,
      ["club_id", "user_id", "status", "role"], "id, club_id, user_id");
    const membershipId = new Map(insertedMemberships.map((row) => [
      `${scalar(row.club_id)}:${row.user_id}`, row.id,
    ]));

    const easternOrganisationId = organisationIdByKey.get("eastern");
    const [customEquipment] = await tx`
      insert into public.organisation_equipment_types
        (organisation_id, display_name, normalized_name, created_by)
      values (${easternOrganisationId}, ${model.customEquipment.name},
        ${model.customEquipment.normalizedName}, ${model.showcaseUserId})
      returning id
    `;
    const [customPosition] = await tx`
      insert into public.organisation_shooting_positions
        (organisation_id, display_name, normalized_name, created_by)
      values (${easternOrganisationId}, ${model.customPosition.name},
        ${model.customPosition.normalizedName}, ${model.showcaseUserId})
      returning id
    `;

    const seasonRows = model.seasons.map((season) => ({
      organisation_id: organisationIdByKey.get(season.organisationKey),
      name: season.name,
      description: `${season.name} provides ten fortnightly rounds across the established inter-club programme.`,
      slug: season.slug, status: season.status, entry_opens_at: season.entryOpensAt,
      entry_closes_at: season.entryClosesAt, starts_at: season.startsAt, ends_at: season.endsAt,
      created_by: model.showcaseUserId, updated_by: model.showcaseUserId,
    }));
    const insertedSeasons = await insertChunks(tx, "public.league_seasons", seasonRows,
      ["organisation_id", "name", "description", "slug", "status", "entry_opens_at",
        "entry_closes_at", "starts_at", "ends_at", "created_by", "updated_by"],
      "id, organisation_id, slug");
    const seasonId = new Map(insertedSeasons.map((row) => [
      `${scalar(row.organisation_id)}:${row.slug}`, row.id,
    ]));
    const seasonIdByKey = new Map(model.seasons.map((season) => [
      season.key, seasonId.get(`${scalar(organisationIdByKey.get(season.organisationKey))}:${season.slug}`),
    ]));

    const seriesRows = model.series.map((series) => ({
      organisation_id: organisationIdByKey.get(series.organisationKey), name: series.name,
      slug: series.slug, entry_format: series.entryFormat, team_size: series.teamSize,
      sets_per_round: 1, shots_per_round: series.components.reduce((sum, component) => sum + component.shots, 0),
      created_by: model.showcaseUserId, updated_by: model.showcaseUserId,
      shooting_details_version: 1, equipment_type_code: series.equipment,
      organisation_equipment_type_id: series.customEquipment ? customEquipment.id : null,
    }));
    const insertedSeries = await insertChunks(tx, "public.competition_series", seriesRows,
      ["organisation_id", "name", "slug", "entry_format", "team_size", "sets_per_round",
        "shots_per_round", "created_by", "updated_by", "shooting_details_version",
        "equipment_type_code", "organisation_equipment_type_id"], "id, organisation_id, slug");
    const seriesId = new Map(insertedSeries.map((row) => [
      `${scalar(row.organisation_id)}:${row.slug}`, row.id,
    ]));
    const seriesIdByKey = new Map(model.series.map((series) => [
      series.key, seriesId.get(`${scalar(organisationIdByKey.get(series.organisationKey))}:${series.slug}`),
    ]));

    const seriesComponentRows = model.series.flatMap((series) => series.components.map((component, index) => ({
      competition_series_id: seriesIdByKey.get(series.key), position: index + 1,
      short_label: component.label, maximum_score: component.maximum,
      score_method: component.scoreMethod, shooting_position_mode: "fixed",
      shooting_position_code: component.customPosition ? null : component.position,
      organisation_shooting_position_id: component.customPosition ? customPosition.id : null,
      distance_mode: "fixed", distance_value: component.distance,
      distance_unit: component.distanceUnit, shots: component.shots,
    })));
    await insertChunks(tx, "public.competition_series_score_components", seriesComponentRows,
      ["competition_series_id", "position", "short_label", "maximum_score", "score_method",
        "shooting_position_mode", "shooting_position_code", "organisation_shooting_position_id",
        "distance_mode", "distance_value", "distance_unit", "shots"]);

    const competitionRows = model.competitions.map((competition) => ({
      league_season_id: seasonIdByKey.get(competition.seasonKey), name: competition.name,
      slug: competition.slug,
      description: competition.oneOff
        ? "A standalone Dewar-style open match over two established distances."
        : `${competition.name} edition for ${model.seasons.find((season) => season.key === competition.seasonKey).name}.`,
      status: "draft", entry_format: competition.entryFormat, team_size: competition.teamSize,
      scoring_method: "points_scored",
      maximum_score_per_round: competition.components.reduce((sum, component) => sum + component.maximum, 0),
      shots_per_round: competition.components.reduce((sum, component) => sum + component.shots, 0),
      uses_x_score: competition.usesX, number_of_rounds: 10, entry_fee: competition.fee,
      created_by: model.showcaseUserId, updated_by: model.showcaseUserId,
      entry_window_mode: "season_default", start_date_mode: "season_default",
      sets_per_round: competition.setsPerRound, ranking_method: competition.ranking,
      best_rounds_count: competition.bestRounds, local_scoring_enabled: true,
      competition_series_id: competition.seriesKey ? seriesIdByKey.get(competition.seriesKey) : null,
      shooting_details_version: 1, equipment_type_code: competition.equipment,
      organisation_equipment_type_id: competition.customEquipment ? customEquipment.id : null,
    }));
    const insertedCompetitions = await insertChunks(tx, "public.competitions", competitionRows,
      ["league_season_id", "name", "slug", "description", "status", "entry_format", "team_size",
        "scoring_method", "maximum_score_per_round", "shots_per_round", "uses_x_score",
        "number_of_rounds", "entry_fee", "created_by", "updated_by", "entry_window_mode",
        "start_date_mode", "sets_per_round", "ranking_method", "best_rounds_count",
        "local_scoring_enabled", "competition_series_id", "shooting_details_version",
        "equipment_type_code", "organisation_equipment_type_id"], "id, league_season_id, slug");
    const competitionId = new Map(insertedCompetitions.map((row) => [
      `${scalar(row.league_season_id)}:${row.slug}`, row.id,
    ]));
    const competitionIdByKey = new Map(model.competitions.map((competition) => [
      competition.key, competitionId.get(`${scalar(seasonIdByKey.get(competition.seasonKey))}:${competition.slug}`),
    ]));

    const roundRows = model.competitions.flatMap((competition) => competition.rounds.map((round) => ({
      competition_id: competitionIdByKey.get(competition.key), round_number: round.number,
      deadline: round.deadline, shoot_by_date: round.shootByDate,
    })));
    const insertedRounds = await insertChunks(tx, "public.competition_rounds", roundRows,
      ["competition_id", "round_number", "deadline", "shoot_by_date"],
      "id, competition_id, round_number");
    const roundId = new Map(insertedRounds.map((row) => [
      `${scalar(row.competition_id)}:${row.round_number}`, row.id,
    ]));
    const roundIdByKey = new Map(model.competitions.flatMap((competition) => competition.rounds.map((round) => [
      `${competition.key}:${round.number}`,
      roundId.get(`${scalar(competitionIdByKey.get(competition.key))}:${round.number}`),
    ])));

    const competitionComponentRows = model.competitions.flatMap((competition) => competition.components.map((component, index) => ({
      competition_id: competitionIdByKey.get(competition.key), position: index + 1,
      short_label: component.label, maximum_score: component.maximum,
      score_method: component.scoreMethod, shooting_position_mode: "fixed",
      shooting_position_code: component.customPosition ? null : component.position,
      organisation_shooting_position_id: component.customPosition ? customPosition.id : null,
      distance_mode: "fixed", distance_value: component.distance,
      distance_unit: component.distanceUnit, shots: component.shots,
    })));
    await insertChunks(tx, "public.competition_score_components", competitionComponentRows,
      ["competition_id", "position", "short_label", "maximum_score", "score_method",
        "shooting_position_mode", "shooting_position_code", "organisation_shooting_position_id",
        "distance_mode", "distance_value", "distance_unit", "shots"]);

    await tx`
      update public.competitions
      set status = 'published'
      where status = 'draft' and ranking_method <> 'round_robin'
    `;

    const entryRows = model.participations.map((participation) => ({
      competition_id: competitionIdByKey.get(participation.competitionKey),
      club_id: clubIdByKey.get(participation.clubKey), status: "submitted",
      submitted_at: `${model.seasons.find((season) => season.key === model.competitions
        .find((competition) => competition.key === participation.competitionKey).seasonKey).entryClosesAt}T12:00:00Z`,
      created_by: model.showcaseUserId, updated_by: model.showcaseUserId,
    }));
    const insertedEntries = await insertChunks(tx, "public.club_competition_entries", entryRows,
      ["competition_id", "club_id", "status", "submitted_at", "created_by", "updated_by"],
      "id, competition_id, club_id");
    const entryId = new Map(insertedEntries.map((row) => [
      `${scalar(row.competition_id)}:${scalar(row.club_id)}`, row.id,
    ]));
    const entryIdByKey = new Map(model.participations.map((participation) => [
      participation.key,
      entryId.get(`${scalar(competitionIdByKey.get(participation.competitionKey))}:${scalar(clubIdByKey.get(participation.clubKey))}`),
    ]));

    const entrantRows = model.participations.flatMap((participation) => participation.entrants.map((entrant) => ({
      club_competition_entry_id: entryIdByKey.get(participation.key), position: entrant.position,
    })));
    const insertedEntrants = await insertChunks(tx, "public.competition_entrants", entrantRows,
      ["club_competition_entry_id", "position"], "id, club_competition_entry_id, position");
    const entrantId = new Map(insertedEntrants.map((row) => [
      `${scalar(row.club_competition_entry_id)}:${row.position}`, row.id,
    ]));
    const entrantIdByKey = new Map(model.participations.flatMap((participation) => participation.entrants.map((entrant) => [
      entrant.key, entrantId.get(`${scalar(entryIdByKey.get(participation.key))}:${entrant.position}`),
    ])));

    const participantRows = [];
    const participantKeyByIdentity = new Map();
    for (const participation of model.participations) {
      const clubId = clubIdByKey.get(participation.clubKey);
      for (const entrant of participation.entrants) {
        for (const member of entrant.members) {
          const shooter = shooterByKey.get(member.shooterKey);
          participantRows.push({
            club_competition_entry_id: entryIdByKey.get(participation.key),
            competition_entrant_id: entrantIdByKey.get(entrant.key),
            club_membership_id: membershipId.get(`${scalar(clubId)}:${shooter.authId}`),
            slot_number: member.slot,
          });
          participantKeyByIdentity.set(
            `${scalar(entrantIdByKey.get(entrant.key))}:${shooter.authId}`,
            `${entrant.key}:${shooter.key}`,
          );
        }
      }
    }
    const insertedParticipants = await insertChunks(tx, "public.competition_entrant_participants", participantRows,
      ["club_competition_entry_id", "competition_entrant_id", "club_membership_id", "slot_number"],
      "id, competition_entrant_id, club_membership_id");
    const participantIdByKey = new Map();
    for (const row of insertedParticipants) {
      const membership = insertedMemberships.find((item) => scalar(item.id) === scalar(row.club_membership_id));
      const key = participantKeyByIdentity.get(`${scalar(row.competition_entrant_id)}:${membership.user_id}`);
      participantIdByKey.set(key, row.id);
    }

    const currentProneKey = "eastern:summer-2026:prone-individual";
    const currentPairsKey = "eastern:summer-2026:prone-pairs";
    const divisionCompetitionKeys = model.competitions
      .filter((competition) => (competition.organisationKey === "eastern" && competition.templateKey !== "prone-individual")
        || competition.ranking === "round_robin")
      .map((competition) => competition.key);
    const divisionConfigs = divisionCompetitionKeys.map((key) => ({
      competition_id: competitionIdByKey.get(key), target_size: key.startsWith("eastern:") ? 6 : 5,
      status: "draft", created_by: model.showcaseUserId, updated_by: model.showcaseUserId,
    }));
    await insertChunks(tx, "public.competition_division_configs", divisionConfigs,
      ["competition_id", "target_size", "status", "created_by", "updated_by"]);

    const divisionRows = [];
    const divisionCountByCompetition = new Map();
    for (const key of divisionCompetitionKeys) {
      const entrantCount = model.participations.filter((item) => item.competitionKey === key)
        .reduce((sum, item) => sum + item.entrants.length, 0);
      const count = key.startsWith("eastern:") ? Math.min(entrantCount, entrantCount >= 16 ? 4 : 3) : 2;
      divisionCountByCompetition.set(key, count);
      for (let position = 1; position <= count; position += 1) {
        divisionRows.push({
          competition_id: competitionIdByKey.get(key), name: `Division ${position}`,
          position,
        });
      }
    }
    const insertedDivisions = await insertChunks(tx, "public.competition_divisions", divisionRows,
      ["competition_id", "name", "position"], "id, competition_id, position");
    const divisionId = new Map(insertedDivisions.map((row) => [
      `${scalar(row.competition_id)}:${row.position}`, row.id,
    ]));
    const assignmentRows = [];
    for (const key of divisionCompetitionKeys) {
      const entrantKeys = model.participations.filter((item) => item.competitionKey === key)
        .flatMap((item) => item.entrants.map((entrant) => entrant.key));
      const divisionCount = divisionCountByCompetition.get(key);
      entrantKeys.forEach((entrantKey, index) => assignmentRows.push({
        competition_entrant_id: entrantIdByKey.get(entrantKey),
        competition_id: competitionIdByKey.get(key),
        competition_division_id: divisionId.get(`${scalar(competitionIdByKey.get(key))}:${index % divisionCount + 1}`),
      }));
    }
    await insertChunks(tx, "public.competition_division_assignments", assignmentRows,
      ["competition_entrant_id", "competition_id", "competition_division_id"]);

    const roundRobinCompetitionKeys = divisionCompetitionKeys.filter((item) => (
      model.competitions.find((competition) => competition.key === item).ranking === "round_robin"
    ));
    // Round Robin publication correctly refuses to create a schedule after
    // Competition Start. Within this one seed transaction, temporarily give
    // historical editions a future effective Start, publish them, and let the
    // real Division lifecycle generate the immutable fixtures below. Their
    // canonical season-default Start is restored before commit. No trigger or
    // constraint is disabled and no fixture row is fabricated directly.
    for (const key of roundRobinCompetitionKeys) {
      await tx`
        update public.competitions
        set start_date_mode = 'custom', custom_starts_at = '2099-01-01'
        where id = ${competitionIdByKey.get(key)}
      `;
    }
    await tx`
      update public.competitions
      set status = 'published'
      where status = 'draft' and ranking_method = 'round_robin'
    `;
    await tx`
      update public.competition_division_configs
      set status = 'published', published_at = clock_timestamp()
      where competition_id in ${tx(divisionCompetitionKeys.map((key) => competitionIdByKey.get(key)))}
    `;
    for (const key of roundRobinCompetitionKeys.filter((item) => item !== currentPairsKey)) {
      await tx`
        update public.competitions
        set start_date_mode = 'season_default', custom_starts_at = null
        where id = ${competitionIdByKey.get(key)}
      `;
    }

    // Establish edition provenance from each preceding canonical configuration.
    for (const series of model.series) {
      const editions = model.competitions.filter((competition) => competition.seriesKey === series.key)
        .sort((left, right) => left.seasonIndex - right.seasonIndex);
      for (let index = 1; index < editions.length; index += 1) {
        const currentId = competitionIdByKey.get(editions[index].key);
        const previousId = competitionIdByKey.get(editions[index - 1].key);
        const [{ version }] = await tx`
          select private.competition_configuration_version(${previousId}) as version
        `;
        await tx`
          update public.competitions
          set configuration_source_competition_id = ${previousId},
              configuration_source_version = ${version}
          where id = ${currentId}
        `;
      }
    }

    const currentSeasonId = seasonIdByKey.get("eastern:summer-2026");
    const [concurrentGroup] = await tx`
      insert into public.concurrent_shooting_groups
        (organisation_id, league_season_id, name, status, created_by, updated_by)
      values (${easternOrganisationId}, ${currentSeasonId},
        'Summer Prone Shared Cards', 'draft', ${model.showcaseUserId}, ${model.showcaseUserId})
      returning id
    `;
    await tx`
      insert into public.concurrent_shooting_group_competitions
        (concurrent_shooting_group_id, competition_id, created_by)
      values
        (${concurrentGroup.id}, ${competitionIdByKey.get(currentProneKey)}, ${model.showcaseUserId}),
        (${concurrentGroup.id}, ${competitionIdByKey.get(currentPairsKey)}, ${model.showcaseUserId})
    `;
    const physicalRounds = await insertChunks(tx, "public.concurrent_shooting_rounds",
      Array.from({ length: 10 }, (_, index) => ({
        concurrent_shooting_group_id: concurrentGroup.id, position: index + 1,
        label: `Round ${index + 1}`, created_by: model.showcaseUserId, updated_by: model.showcaseUserId,
      })), ["concurrent_shooting_group_id", "position", "label", "created_by", "updated_by"],
      "id, position");
    const physicalRoundId = new Map(physicalRounds.map((row) => [row.position, row.id]));
    const mappingRows = physicalRounds.flatMap((physicalRound) => [currentProneKey, currentPairsKey].map((key) => ({
      concurrent_shooting_group_id: concurrentGroup.id,
      concurrent_shooting_round_id: physicalRound.id,
      competition_id: competitionIdByKey.get(key),
      competition_round_id: roundIdByKey.get(`${key}:${physicalRound.position}`),
      created_by: model.showcaseUserId,
    })));
    await insertChunks(tx, "public.concurrent_shooting_round_mappings", mappingRows,
      ["concurrent_shooting_group_id", "concurrent_shooting_round_id", "competition_id",
        "competition_round_id", "created_by"]);
    // Reconstruct an already-active current group through the real V2
    // activation RPC. Both members receive a transaction-local future Start;
    // the RPC performs its full compatibility and mapping validation, then the
    // canonical Starts are restored before any scores or commit.
    await tx`
      update public.competitions
      set start_date_mode = 'custom', custom_starts_at = '2099-01-01'
      where id = ${competitionIdByKey.get(currentProneKey)}
    `;
    await tx`
      select public.activate_concurrent_shooting_group(
        ${easternOrganisationId}, ${concurrentGroup.id}
      )
    `;
    await tx`
      update public.competitions
      set start_date_mode = 'season_default', custom_starts_at = null
      where id in ${tx([
        competitionIdByKey.get(currentProneKey),
        competitionIdByKey.get(currentPairsKey),
      ])}
    `;

    const sourceRows = model.scores.map((source) => ({
      shooter_profile_id: shooterByKey.get(source.shooterKey).authId,
      concurrent_shooting_round_id: source.concurrent ? physicalRoundId.get(source.roundNumber) : null,
      version: 1, created_by: model.showcaseUserId, updated_by: model.showcaseUserId,
      created_at: source.occurredAt,
      updated_at: source.occurredAt,
    }));
    const insertedSources = await insertChunks(tx, "public.shooting_score_sources", sourceRows,
      ["shooter_profile_id", "concurrent_shooting_round_id", "version", "created_by", "updated_by",
        "created_at", "updated_at"], "id, created_at");
    const sourceIdByInstant = new Map(insertedSources.map((row) => [instantKey(row.created_at), row.id]));
    const sourceIdByKey = new Map(model.scores.map((source) => [
      source.key, sourceIdByInstant.get(source.occurredAt),
    ]));

    const usageRows = model.scores.flatMap((source) => source.usages.map((usage) => ({
      shooting_score_source_id: sourceIdByKey.get(source.key),
      competition_id: competitionIdByKey.get(usage.competitionKey),
      competition_round_id: roundIdByKey.get(`${usage.competitionKey}:${usage.roundNumber}`),
      competition_entrant_participant_id: participantIdByKey.get(`${usage.entrantKey}:${usage.shooterKey}`),
      created_by: model.showcaseUserId, updated_by: model.showcaseUserId,
    })));
    await insertChunks(tx, "public.competition_score_usages", usageRows,
      ["shooting_score_source_id", "competition_id", "competition_round_id",
        "competition_entrant_participant_id", "created_by", "updated_by"]);

    // The canonical score-value guard requires a source to have at least one
    // legitimate Competition usage. Usages may be attached before values and
    // validate every value again as those canonical ACHIEVED rows arrive.
    const valueRows = model.scores.flatMap((source) => source.values.map((value) => ({
      shooting_score_source_id: sourceIdByKey.get(source.key), set_number: value.setNumber,
      component_position: value.componentPosition, achieved_score: value.achieved,
      x_count: value.xCount, created_by: model.showcaseUserId, updated_by: model.showcaseUserId,
    })));
    await insertChunks(tx, "public.shooting_score_values", valueRows,
      ["shooting_score_source_id", "set_number", "component_position", "achieved_score",
        "x_count", "created_by", "updated_by"]);

    const concurrentEvents = model.scores.filter((source) => source.concurrent).map((source) => ({
      shooting_score_source_id: sourceIdByKey.get(source.key), actor_id: model.showcaseUserId,
      origin_competition_id: competitionIdByKey.get(source.usages[0].competitionKey),
      origin_competition_round_id: roundIdByKey.get(`${source.usages[0].competitionKey}:${source.roundNumber}`),
      operation: "create",
    }));
    for (const batch of chunk(concurrentEvents)) {
      await tx`
        insert into public.shooting_score_change_events (
          shooting_score_source_id, actor_id, origin_competition_id,
          origin_competition_round_id, operation, before_state, after_state
        )
        select event.shooting_score_source_id, event.actor_id,
          event.origin_competition_id, event.origin_competition_round_id,
          event.operation, null,
          private.shooting_score_source_state(event.shooting_score_source_id)
        from jsonb_to_recordset(${tx.json(batch)}) as event (
          shooting_score_source_id bigint,
          actor_id uuid,
          origin_competition_id bigint,
          origin_competition_round_id bigint,
          operation text
        )
      `;
    }

    const [averageContext] = await tx`
      insert into public.average_contexts
        (organisation_id, name, basis_maximum, created_by, updated_by)
      values (${easternOrganisationId}, 'Smallbore Prone Ex100', 100,
        ${model.showcaseUserId}, ${model.showcaseUserId})
      returning id
    `;
    const [averagePolicy] = await tx`
      insert into public.average_policies
        (organisation_id, name, created_by, updated_by)
      values (${easternOrganisationId}, 'Current then preceding league history',
        ${model.showcaseUserId}, ${model.showcaseUserId})
      returning id
    `;
    const [averagePolicyVersion] = await tx`
      insert into public.average_policy_versions
        (average_policy_id, version_number, strategy, configuration, created_by)
      values (${averagePolicy.id}, 1, 'current_then_preceding',
        ${tx.json({ minimum_current_scores: 4, minimum_preceding_scores: 4, fallback: "manual" })},
        ${model.showcaseUserId})
      returning id
    `;
    const averageCompetitionKeys = model.competitions
      .filter((competition) => competition.organisationKey === "eastern"
        && competition.templateKey === "prone-individual")
      .map((competition) => competition.key);
    await insertChunks(tx, "public.competition_average_settings", averageCompetitionKeys.map((key) => ({
      competition_id: competitionIdByKey.get(key), average_context_id: averageContext.id,
      average_policy_version_id: averagePolicyVersion.id, contributes_to_history: true,
      created_by: model.showcaseUserId, updated_by: model.showcaseUserId,
    })), ["competition_id", "average_context_id", "average_policy_version_id",
      "contributes_to_history", "created_by", "updated_by"]);

    for (const key of ["eastern:winter-2025:prone-individual", currentProneKey]) {
      const competition = model.competitions.find((item) => item.key === key);
      await tx`
        select public.calculate_competition_starting_averages(
          ${easternOrganisationId}, ${seasonIdByKey.get(competition.seasonKey)}, ${competitionIdByKey.get(key)}
        )
      `;
      await tx`
        select public.finalise_competition_starting_averages(
          ${easternOrganisationId}, ${seasonIdByKey.get(competition.seasonKey)}, ${competitionIdByKey.get(key)}
        )
      `;
    }

    const showcaseAnalytics = await tx`
      select public.get_my_shooter_analytics() as payload
    `;
    const payload = showcaseAnalytics[0].payload;
    const counts = (await tx`
      select
        (select count(*)::integer from public.organisations) as organisations,
        (select count(*)::integer from public.clubs) as clubs,
        (select count(*)::integer from public.profiles) as shooters,
        (select count(*)::integer from public.league_seasons) as seasons,
        (select count(*)::integer from public.competition_series) as series,
        (select count(*)::integer from public.competitions) as competitions,
        (select count(*)::integer from public.competition_rounds) as rounds,
        (select count(*)::integer from public.club_competition_entries) as entries,
        (select count(*)::integer from public.competition_entrants) as entrants,
        (select count(*)::integer from public.competition_entrant_participants) as participants,
        (select count(*)::integer from public.shooting_score_sources) as sources,
        (select count(*)::integer from public.shooting_score_values) as values,
        (select count(*)::integer from public.competition_score_usages) as usages,
        (select count(*)::integer from public.concurrent_shooting_groups) as concurrent_groups,
        (select count(*)::integer from public.average_contexts) as average_contexts
    `)[0];

    const fail = (condition, message) => { if (condition) throw new Error(`Post-seed validation failed: ${message}`); };
    fail(counts.organisations !== 3, `expected 3 Organisations, found ${counts.organisations}`);
    fail(counts.clubs !== 15, `expected 15 Clubs, found ${counts.clubs}`);
    fail(counts.shooters !== 96, `expected 96 shooters, found ${counts.shooters}`);
    fail(counts.seasons !== 18 || counts.competitions !== 91 || counts.rounds !== 910,
      "Season, Competition, or Round totals are incorrect");
    fail(counts.entries !== model.participations.length
      || counts.entrants !== model.participations.flatMap((item) => item.entrants).length
      || counts.participants !== model.participations.flatMap((item) => item.entrants)
        .flatMap((item) => item.members).length
      || counts.sources !== model.scores.length
      || counts.values !== model.scores.flatMap((item) => item.values).length
      || counts.usages !== model.scores.flatMap((item) => item.usages).length,
    "entry, participant, or canonical score totals are incorrect");
    fail(payload.summary.physical_shoot_count < 20, "showcase analytics has fewer than 20 physical shoots");
    fail(payload.chart_points.length !== payload.summary.physical_shoot_count,
      "analytics chart does not deduplicate to one point per physical source");
    fail(new Set([
      payload.summary.best_score_percentage,
      payload.summary.mean_score_percentage,
      payload.summary.recent_score_percentage,
    ]).size !== 3, "showcase Best, Mean, and Recent statistics should differ");
    fail(payload.summary.trend_direction === "unavailable" || payload.recent_scores.length < 1,
      "showcase trend or recent history is missing");
    fail(!payload.chart_points.some((point) => point.components.length > 1),
      "showcase analytics has no multi-component physical result");
    fail(payload.filter_options.seasons.length < 4 || payload.filter_options.equipment.length < 2
      || payload.filter_options.positions.length < 3 || payload.filter_options.distances.length < 3,
    "showcase analytics filters are not meaningfully populated");

    const [integrity] = await tx`
      select
        exists (
          select 1 from public.shooting_score_values value
          join public.shooting_score_sources source on source.id = value.shooting_score_source_id
          join public.competition_score_usages usage on usage.shooting_score_source_id = source.id
          join public.competition_score_components component
            on component.competition_id = usage.competition_id
           and component.position = value.component_position
          where value.achieved_score > component.maximum_score
        ) as score_over_maximum,
        exists (
          select 1 from public.shooting_score_values value
          join public.shooting_score_sources source on source.id = value.shooting_score_source_id
          join public.competition_score_usages usage on usage.shooting_score_source_id = source.id
          join public.competitions competition on competition.id = usage.competition_id
          join public.competition_score_components component
            on component.competition_id = competition.id
           and component.position = value.component_position
          where (not competition.uses_x_score and value.x_count is not null)
             or (competition.uses_x_score and (value.x_count is null or value.x_count > component.shots))
        ) as invalid_x,
        (select count(*)::integer from public.competitions where slug = 'eastern-dewar-open'
          and competition_series_id is null) as one_offs,
        (select count(*)::integer from public.concurrent_shooting_groups
          where status = 'active' and compatibility_version = 2) as active_v2_groups,
        (select count(*)::integer from public.shooting_score_sources source
          where source.shooter_profile_id = ${model.showcaseUserId}
            and (select count(*) from public.competition_score_usages usage
              where usage.shooting_score_source_id = source.id) > 1) as showcase_shared_sources,
        (select count(*)::integer from public.competition_participant_starting_averages
          where status = 'frozen' and origin = 'calculated') as frozen_calculated_averages,
        (select count(*)::integer
          from public.organisation_staff as staff
          join public.organisations as organisation on organisation.id = staff.organisation_id
          where organisation.name = 'Eastern Region Shooting Association'
            and staff.user_id = ${model.showcaseUserId}
            and staff.role = 'owner' and staff.status = 'active') as showcase_organisation_ownerships,
        (select count(*)::integer
          from public.club_memberships as membership
          join public.clubs as club on club.id = membership.club_id
          where club.name = 'Basildon Rifle and Pistol Club'
            and membership.user_id = ${model.showcaseUserId}
            and membership.role = 'owner' and membership.status = 'active') as showcase_club_ownerships,
        (select count(*)::integer
          from public.league_seasons as season
          join public.organisations as organisation on organisation.id = season.organisation_id
          where organisation.name = 'Eastern Region Shooting Association') as eastern_seasons,
        (select count(*)::integer
          from public.league_seasons as season
          join public.organisations as organisation on organisation.id = season.organisation_id
          where organisation.name = 'Eastern Region Shooting Association'
            and ((season.slug = 'summer-2026' and season.status = 'active')
              or (season.slug = 'winter-2026' and season.status = 'open'))) as eastern_current_future_states,
        (select count(*)::integer from public.competition_series as series
          where (select count(distinct competition.league_season_id)
            from public.competitions as competition
            where competition.competition_series_id = series.id) >= 2) as spanning_series,
        (select count(*)::integer from public.competitions as competition
          where (select count(*) from public.competition_rounds as round
            where round.competition_id = competition.id) <> 10) as bad_round_counts,
        (select count(*)::integer from public.competition_rounds
          where deadline < current_date) as released_rounds,
        (select count(*)::integer from public.competition_rounds
          where deadline >= current_date) as unreleased_rounds,
        (select count(*)::integer from public.average_policy_versions
          where strategy = 'current_then_preceding') as current_then_preceding_policies,
        (select count(*)::integer from public.competitions
          where organisation_equipment_type_id = ${customEquipment.id}) as custom_equipment_editions,
        (select count(*)::integer from public.competition_score_components
          where organisation_shooting_position_id = ${customPosition.id}) as custom_position_components,
        (select count(*)::integer
          from public.competitions as competition
          join public.league_seasons as season on season.id = competition.league_season_id
          join public.organisations as organisation on organisation.id = season.organisation_id
          where organisation.name = 'Eastern Region Shooting Association'
            and season.slug = 'summer-2026') as eastern_summer_2026_competitions,
        (select count(*)::integer
          from public.competition_score_usages as usage
          join public.competition_rounds as round on round.id = usage.competition_round_id
          where round.deadline >= current_date) as unreleased_score_usages,
        (select count(*)::integer from (
          select source.shooter_profile_id, source.concurrent_shooting_round_id
          from public.shooting_score_sources as source
          where source.concurrent_shooting_round_id is not null
          group by source.shooter_profile_id, source.concurrent_shooting_round_id
          having count(*) > 1
        ) as duplicates) as duplicate_concurrent_sources,
        (select count(*)::integer from public.concurrent_shooting_round_mappings
          where concurrent_shooting_group_id = (
            select id from public.concurrent_shooting_groups limit 1
          )) as concurrent_round_mappings,
        (select count(*)::integer from public.shooting_score_change_events as event
          where event.operation <> 'create'
            or event.before_state is not null
            or jsonb_typeof(event.after_state) <> 'object'
            or event.after_state is distinct from
              private.shooting_score_source_state(event.shooting_score_source_id)
        ) as invalid_concurrent_audit_events,
        (select count(distinct source.id)::integer
          from public.shooting_score_sources as source
          join public.competition_score_usages as usage
            on usage.shooting_score_source_id = source.id
          join public.competition_rounds as round
            on round.id = usage.competition_round_id
          where source.created_at::date <> round.deadline
            or source.updated_at <> source.created_at
        ) as implausible_source_timestamps
    `;
    fail(integrity.score_over_maximum || integrity.invalid_x, "score bounds or X-count rules failed");
    fail(integrity.one_offs !== 1, "Eastern Dewar Open is not a unique unlinked One-off");
    fail(integrity.active_v2_groups !== 1 || integrity.showcase_shared_sources < 1,
      "Concurrent V2 shared-source example is invalid");
    fail(integrity.frozen_calculated_averages < 1, "no calculated Starting Average was frozen");
    fail(integrity.showcase_organisation_ownerships !== 1 || integrity.showcase_club_ownerships !== 1,
      "showcase user does not own Eastern Region and Basildon");
    fail(integrity.eastern_seasons !== 6 || integrity.eastern_current_future_states !== 2,
      "Eastern Season history or current/upcoming state is incorrect");
    fail(integrity.spanning_series !== counts.series, "not every recurring Series spans Seasons");
    fail(integrity.bad_round_counts !== 0 || integrity.released_rounds < 1 || integrity.unreleased_rounds < 1,
      "Round counts or released/unreleased chronology is invalid");
    fail(integrity.current_then_preceding_policies !== 1 || integrity.custom_equipment_editions < 2
      || integrity.custom_position_components < 2,
    "Average policy or reusable custom taxonomy fixture is missing");
    fail(integrity.eastern_summer_2026_competitions !== 6 || integrity.unreleased_score_usages !== 0,
      "Eastern Summer 2026 Competition count or unreleased-score exclusion is invalid");
    fail(integrity.duplicate_concurrent_sources !== 0 || integrity.concurrent_round_mappings !== 20,
      "Concurrent physical source uniqueness or explicit Round mappings are invalid");
    fail(integrity.invalid_concurrent_audit_events !== 0,
      "Concurrent audit events do not match canonical source state");
    fail(integrity.implausible_source_timestamps !== 0,
      "score source timestamps do not match Competition Round history");

    for (const dropout of model.dropoutCases) {
      const shooter = shooterByKey.get(dropout.shooterKey);
      const competitionId = competitionIdByKey.get(dropout.competitionKey);
      const [{ scored, zeros }] = await tx`
        select count(distinct usage.competition_round_id)::integer as scored,
          count(*) filter (where value.achieved_score = 0)::integer as zeros
        from public.competition_score_usages usage
        join public.shooting_score_sources source on source.id = usage.shooting_score_source_id
        join public.shooting_score_values value on value.shooting_score_source_id = source.id
        where usage.competition_id = ${competitionId}
          and source.shooter_profile_id = ${shooter.authId}
      `;
      fail(scored !== 4 || zeros !== 0, `dropout case ${dropout.competitionKey} is not four scored Rounds followed by missing scores`);
    }

    return { ...counts, showcaseStatistics: payload.summary, integrity };
  });
  return summary;
}
